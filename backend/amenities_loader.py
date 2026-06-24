"""Fetch OSM amenities (gas stations, schools, hospitals) via Overpass API
and store them in DuckDB with H3 indexes at resolutions 7 and 9.

Usage:
    python3 amenities_loader.py
"""
import time

import h3
import requests

from database import get_db, _lock, execute_write, executemany_write, drop_indexes, recreate_indexes

OVERPASS_URL   = "https://overpass.kumi.systems/api/interpreter"
HEADERS        = {"User-Agent": "PropIQ/1.0 (property investment research tool)"}
# Colorado state bounding box: (south, west, north, east)
COLORADO_BBOX  = (36.9, -109.1, 41.1, -102.0)
AMENITY_TYPES  = ["gas_station", "school", "hospital"]


def fetch(bbox: tuple = COLORADO_BBOX) -> dict[str, list]:
    """Fetch all target amenities from Overpass within bbox."""
    s, w, n, e = bbox
    query = f"""
[out:json][timeout:120];
(
  node["amenity"~"{'|'.join(AMENITY_TYPES)}"]({s},{w},{n},{e});
  way["amenity"~"{'|'.join(AMENITY_TYPES)}"]({s},{w},{n},{e});
);
out center;
"""
    print("Querying Overpass API …")
    resp = requests.post(OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=130)
    resp.raise_for_status()
    elements = resp.json()["elements"]
    print(f"  Received {len(elements)} OSM elements.")

    by_type: dict[str, list] = {t: [] for t in AMENITY_TYPES}
    for el in elements:
        # nodes have lat/lon directly; ways have a 'center' object
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        atype = el.get("tags", {}).get("amenity")
        if lat and lng and atype in AMENITY_TYPES:
            by_type[atype].append({
                "osm_id": el["id"],
                "type":   atype,
                "name":   el.get("tags", {}).get("name"),
                "lat":    float(lat),
                "lng":    float(lng),
                "h3_9":   h3.latlng_to_cell(float(lat), float(lng), 9),
                "h3_7":   h3.latlng_to_cell(float(lat), float(lng), 7),
            })
    return by_type


def load(bbox: tuple = COLORADO_BBOX) -> int:
    by_type = fetch(bbox)
    all_amenities = [a for amenities in by_type.values() for a in amenities]

    if not all_amenities:
        print("No amenities fetched — database not modified.")
        return 0

    drop_indexes("amenities")
    execute_write("DELETE FROM amenities")

    rows: list[tuple] = []
    for i, a in enumerate(all_amenities, start=1):
        rows.append((i, a["osm_id"], a["type"], a["name"],
                     a["lat"], a["lng"], a["h3_7"], a["h3_9"]))

    executemany_write(
        "INSERT INTO amenities (id, osm_id, type, name, lat, lng, h3_7, h3_9) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    recreate_indexes("amenities")

    for atype, amenities in by_type.items():
        print(f"  Stored {len(amenities):4d} {atype}s")

    print(f"Total: {len(rows)} amenities in DuckDB.")
    return len(rows)


if __name__ == "__main__":
    load()
