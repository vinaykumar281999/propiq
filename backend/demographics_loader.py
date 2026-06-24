"""Fetch Census ACS 5-year demographics for all Colorado census tracts
and store them in DuckDB with H3 resolution-7 indexes and WKT polygon
geometries for DuckDB spatial ST_Intersects queries.

Uses:
  - ACS 2022 5-year estimates (https://api.census.gov/data/2022/acs/acs5)
  - TIGER Web Service for tract centroid lat/lng and polygon boundaries

Variables fetched per tract:
  B01003_001E  — total population
  B01001_003E … B01001_006E   — male under 18 (4 age groups)
  B01001_027E … B01001_030E   — female under 18 (4 age groups)
  B19013_001E  — median household income

Usage:
    python3 demographics_loader.py [CENSUS_API_KEY]
    python3 demographics_loader.py        # works without a key (500 req/day limit)
"""
import sys
import time

import h3
import requests

from database import execute_write, executemany_write, get_db, _lock, drop_indexes, recreate_indexes

CENSUS_ACS_URL = "https://api.census.gov/data/2022/acs/acs5"
TIGER_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services"
    "/TIGERweb/Tracts_Blocks/MapServer/0/query"
)

# Colorado state FIPS — fetch all counties in the state
STATE_FIPS = "08"

# ACS variables
MALE_UNDER18_VARS   = ["B01001_003E", "B01001_004E", "B01001_005E", "B01001_006E"]
FEMALE_UNDER18_VARS = ["B01001_027E", "B01001_028E", "B01001_029E", "B01001_030E"]
ALL_VARS = (
    ["B01003_001E", "B19013_001E"]
    + MALE_UNDER18_VARS
    + FEMALE_UNDER18_VARS
    + ["NAME"]
)


def _fetch_acs(api_key: str | None) -> list[dict]:
    params: dict = {
        "get": ",".join(ALL_VARS),
        "for": "tract:*",
        "in":  f"state:{STATE_FIPS}",
    }
    if api_key:
        params["key"] = api_key

    print("Fetching Census ACS data for all Colorado tracts …")
    req = requests.Request("GET", CENSUS_ACS_URL, params=params).prepare()
    print(f"  URL: {req.url}")
    resp = requests.get(CENSUS_ACS_URL, params=params, timeout=60)
    print(f"  HTTP {resp.status_code}")
    resp.raise_for_status()
    raw = resp.json()
    print(f"  Response type: {type(raw).__name__}, length: {len(raw) if isinstance(raw, list) else 'n/a'}")
    if not isinstance(raw, list) or len(raw) < 2:
        print(f"  Unexpected response body: {resp.text[:500]}")
        return []
    headers = raw[0]
    rows = [dict(zip(headers, row)) for row in raw[1:]]
    print(f"  Got {len(rows)} census tracts from ACS.")
    return rows


def _geojson_to_wkt(geom: dict) -> str:
    """Convert a GeoJSON geometry dict to WKT string (lng lat coordinate order)."""
    def ring_wkt(ring: list) -> str:
        return "(" + ", ".join(f"{c[0]} {c[1]}" for c in ring) + ")"

    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])

    if gtype == "Polygon":
        rings = ", ".join(ring_wkt(r) for r in coords)
        return f"POLYGON({rings})"
    if gtype == "MultiPolygon":
        polys = []
        for poly in coords:
            rings = ", ".join(ring_wkt(r) for r in poly)
            polys.append(f"({rings})")
        return f"MULTIPOLYGON({', '.join(polys)})"
    return ""


def _fetch_tiger_data(state_fips: str) -> tuple[dict, dict]:
    """Fetch TIGER tract centroids and polygon boundaries for a whole state.

    Returns:
        centroids: {GEOID: (lat, lng)}
        wkt_geoms: {GEOID: wkt_polygon_string}
    """
    centroids: dict[str, tuple[float, float]] = {}
    wkt_geoms: dict[str, str] = {}

    offset = 0
    page_size = 1000

    print(f"Fetching TIGER tract boundaries for state {state_fips} …")
    while True:
        params = {
            "where":             f"STATEFP='{state_fips}'",
            "outFields":         "GEOID,INTPTLAT,INTPTLON",
            "returnGeometry":    "true",
            "geometryType":      "esriGeometryPolygon",
            "outSR":             "4326",
            "f":                 "geojson",
            "resultRecordCount": page_size,
            "resultOffset":      offset,
        }
        resp = requests.get(TIGER_URL, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        features = data.get("features", [])

        if not features:
            break

        for feat in features:
            props = feat.get("properties", {})
            geom  = feat.get("geometry")
            geoid = props.get("GEOID")
            lat   = props.get("INTPTLAT")
            lng   = props.get("INTPTLON")

            if not geoid:
                continue
            if lat and lng:
                centroids[geoid] = (float(lat), float(lng))
            if geom:
                wkt = _geojson_to_wkt(geom)
                if wkt:
                    wkt_geoms[geoid] = wkt

        if len(features) < page_size:
            break
        offset += page_size
        time.sleep(0.3)

    print(f"  Got {len(centroids)} centroids, {len(wkt_geoms)} polygon boundaries.")
    return centroids, wkt_geoms


def _safe_int(v) -> int | None:
    try:
        n = int(v)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def _safe_float(v) -> float | None:
    try:
        f = float(v)
        return f if f >= 0 else None
    except (TypeError, ValueError):
        return None


def load(api_key: str | None = None) -> int:
    try:
        acs_rows = _fetch_acs(api_key)
    except Exception as exc:
        import traceback
        print(f"Census API error: {exc}")
        traceback.print_exc()
        return 0

    try:
        centroids, wkt_geoms = _fetch_tiger_data(STATE_FIPS)
    except Exception as exc:
        import traceback
        print(f"TIGER data error: {exc}")
        traceback.print_exc()
        centroids, wkt_geoms = {}, {}

    drop_indexes("census_tracts")
    execute_write("DELETE FROM census_tracts")

    db_rows: list[tuple] = []
    for row in acs_rows:
        state  = row.get("state", STATE_FIPS)
        county = row.get("county", "")
        tract  = row.get("tract", "")
        geoid  = f"{state}{county}{tract}"

        total_pop = _safe_int(row.get("B01003_001E"))
        income    = _safe_float(row.get("B19013_001E"))

        male_u18 = sum(
            n for v in MALE_UNDER18_VARS
            if (n := _safe_int(row.get(v))) is not None
        )
        female_u18 = sum(
            n for v in FEMALE_UNDER18_VARS
            if (n := _safe_int(row.get(v))) is not None
        )
        pop_u18 = male_u18 + female_u18 if (male_u18 or female_u18) else None

        lat, lng = centroids.get(geoid, (None, None))
        h3_7     = h3.latlng_to_cell(lat, lng, 7) if lat and lng else None
        geom_wkt = wkt_geoms.get(geoid)

        db_rows.append((
            geoid, county, total_pop, pop_u18,
            income, lat, lng, h3_7, geom_wkt,
        ))

    executemany_write(
        "INSERT INTO census_tracts "
        "(tract_id, county_fips, total_pop, pop_under_18, "
        " median_income, lat, lng, h3_7, geom) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        db_rows,
    )

    recreate_indexes("census_tracts")

    geocoded = sum(1 for r in db_rows if r[7])
    spatial  = sum(1 for r in db_rows if r[8])
    print(
        f"Stored {len(db_rows)} census tracts "
        f"({geocoded} with H3 index, {spatial} with polygon geometry)."
    )
    return len(db_rows)


if __name__ == "__main__":
    key = sys.argv[1] if len(sys.argv) > 1 else None
    load(key)
