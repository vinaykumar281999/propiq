"""Load Redfin CSV data into DuckDB.

Strategy on every reload:
  1. Cache existing geocoded coords from DuckDB before wiping.
  2. If DuckDB is empty (first run), migrate coords from old SQLite DB.
  3. Wipe + bulk-insert from CSV.
  4. Restore cached coords via batch UPDATE (no API calls).
  5. Geocode still-missing rows in metros that already have coverage.
"""
import os
import sqlite3
import time

import h3
import pandas as pd
import requests

from database import get_db, _lock, execute_write, executemany_write, drop_indexes, recreate_indexes

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../data"))
NEIGHBORHOODS_CSV = os.path.join(
    DATA_DIR,
    "redfin_housing_market_monthly_all_neighborhoods_key_metrics_2026_Jan_to_2026_May.csv",
)
CITIES_CSV = os.path.join(
    DATA_DIR,
    "redfin_housing_market_monthly_all_cities_key_metrics_2026_Jan_to_2026_May.csv",
)
OLD_SQLITE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../properties.db")
)

PRICE_COL      = "MEDIAN SALE PRICE NSA ($)"
YOY_COL        = "MEDIAN SALE PRICE NSA YOY (%)"
MIN_HOMES_SOLD = 5
H3_RES         = 7

NOMINATIM = "https://nominatim.openstreetmap.org/search"
HEADERS   = {"User-Agent": "PropIQ/1.0 (property investment research tool)"}


# ── geocoding ─────────────────────────────────────────────────────────────────

def _geocode(name: str, metro: str) -> tuple[float, float] | None:
    city      = metro.replace(" metro area", "").strip()
    state     = city.split(",")[-1].strip()
    city_name = city.split(",")[0].strip()
    for q in [f"{name}, {city}", f"{name}, {state}", name]:
        try:
            r = requests.get(
                NOMINATIM,
                params={"q": q, "format": "json", "limit": 5, "countrycodes": "us"},
                headers=HEADERS, timeout=10,
            )
            results = r.json()
            if results:
                for res in results:
                    dn = res.get("display_name", "").lower()
                    if city_name.lower() in dn or state.lower() in dn:
                        return float(res["lat"]), float(res["lon"])
                return float(results[0]["lat"]), float(results[0]["lon"])
        except Exception:
            pass
        time.sleep(1.1)
    return None


# ── CSV parsing ───────────────────────────────────────────────────────────────

def _parse_csv(path: str) -> list[dict]:
    df = pd.read_csv(path)
    df.columns = df.columns.str.strip()
    df = df[df["HOMES SOLD"] >= MIN_HOMES_SOLD]
    df = df.dropna(subset=[PRICE_COL, YOY_COL])
    df = df[df[YOY_COL] != 0]
    df = (
        df.sort_values("PERIOD BEGIN", ascending=False)
          .drop_duplicates(subset=["REGION NAME"], keep="first")
    )
    rows = []
    for idx, (_, row) in enumerate(df.iterrows(), start=1):
        price = float(row[PRICE_COL])
        yoy   = float(row[YOY_COL])
        ret   = price * (yoy / 100)
        if price > 0 and ret > 0:
            dom = row.get("MEDIAN DAYS ON MARKET (DAYS)")
            rows.append({
                "id":              idx,
                "name":            row["REGION NAME"],
                "metro":           row.get("METRO") or None,
                "price":           int(price),
                "expected_return": int(ret),
                "days_on_market":  float(dom) if dom and str(dom) != "nan" else None,
            })
    return rows


# ── coordinate caches ─────────────────────────────────────────────────────────

def _duckdb_cache() -> dict[str, tuple]:
    with _lock:
        rows = get_db().execute(
            "SELECT name, lat, lng, h3_7, h3_9 FROM neighborhoods WHERE h3_7 IS NOT NULL"
        ).fetchall()
    return {r[0]: (r[1], r[2], r[3], r[4]) for r in rows}


def _sqlite_migration() -> dict[str, tuple]:
    """One-time import from old SQLite properties.db."""
    if not os.path.exists(OLD_SQLITE):
        return {}
    try:
        con = sqlite3.connect(OLD_SQLITE)
        cur = con.cursor()
        cur.execute(
            "SELECT name, lat, lng, h3_index FROM properties "
            "WHERE h3_index IS NOT NULL AND lat IS NOT NULL"
        )
        cache = {}
        for r in cur.fetchall():
            lat, lng = r[1], r[2]
            h3_9 = h3.latlng_to_cell(lat, lng, 9) if lat and lng else None
            cache[r[0]] = (lat, lng, r[3], h3_9)
        con.close()
        if cache:
            print(f"  Migrated {len(cache)} geocoded rows from old SQLite DB.")
        return cache
    except Exception:
        return {}


# ── main ──────────────────────────────────────────────────────────────────────

def load(source: str = "neighborhoods") -> int:
    csv_path = NEIGHBORHOODS_CSV if source == "neighborhoods" else CITIES_CSV
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    rows = _parse_csv(csv_path)

    # Gather coord cache before wiping
    coord_cache = _duckdb_cache()
    if not coord_cache:
        coord_cache = _sqlite_migration()

    # Drop indexes before bulk DELETE to avoid DuckDB ART "Failed to delete
    # all rows from index" error; recreate them after the INSERT.
    drop_indexes("neighborhoods")
    execute_write("DELETE FROM neighborhoods")
    executemany_write(
        "INSERT INTO neighborhoods "
        "(id, name, metro, price, expected_return, days_on_market, lat, lng, h3_7, h3_9) "
        "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)",
        [
            (r["id"], r["name"], r["metro"], r["price"], r["expected_return"],
             r["days_on_market"])
            for r in rows
        ],
    )

    # Restore cached coords via batch UPDATE
    if coord_cache:
        update_rows = [
            (lat, lng, h3_7, h3_9, name)
            for name, (lat, lng, h3_7, h3_9) in coord_cache.items()
        ]
        executemany_write(
            "UPDATE neighborhoods SET lat=?, lng=?, h3_7=?, h3_9=? WHERE name=?",
            update_rows,
        )
        with _lock:
            restored = get_db().execute(
                "SELECT COUNT(*) FROM neighborhoods WHERE h3_7 IS NOT NULL"
            ).fetchone()[0]
        print(f"  Restored coordinates for {restored}/{len(rows)} neighbourhoods.")

    # Geocode still-missing rows in metros that already have geocoded data
    with _lock:
        active_metros = [
            r[0] for r in get_db().execute(
                "SELECT DISTINCT metro FROM neighborhoods "
                "WHERE h3_7 IS NOT NULL AND metro IS NOT NULL"
            ).fetchall()
        ]

    if active_metros:
        metro_placeholders = ",".join(["?" for _ in active_metros])
        with _lock:
            missing = get_db().execute(
                f"SELECT id, name, metro FROM neighborhoods "
                f"WHERE h3_7 IS NULL AND metro IN ({metro_placeholders})",
                active_metros,
            ).fetchall()

        if missing:
            print(f"  Geocoding {len(missing)} missing neighbourhoods …")
            ok = skipped = 0
            for i, (pid, name, metro) in enumerate(missing, 1):
                result = _geocode(name, metro or "")
                if result:
                    lat, lng = result
                    h3_7 = h3.latlng_to_cell(lat, lng, 7)
                    h3_9 = h3.latlng_to_cell(lat, lng, 9)
                    execute_write(
                        "UPDATE neighborhoods SET lat=?, lng=?, h3_7=?, h3_9=? WHERE id=?",
                        [lat, lng, h3_7, h3_9, pid],
                    )
                    ok += 1
                    print(f"    [{i}/{len(missing)}] ✓  {name}")
                else:
                    skipped += 1
                    print(f"    [{i}/{len(missing)}] ✗  {name}")
                time.sleep(1.1)
            print(f"  Geocoding done: {ok} succeeded, {skipped} not found.")

    recreate_indexes("neighborhoods")
    return len(rows)


if __name__ == "__main__":
    n = load("neighborhoods")
    print(f"Loaded {n} properties.")
