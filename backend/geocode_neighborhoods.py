"""Geocode neighbourhood centers and store H3 indexes in DuckDB.

Usage:
    python3 geocode_neighborhoods.py "Denver, CO metro area"   # one metro
    python3 geocode_neighborhoods.py --all                      # every metro (slow)
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(__file__))

import h3
import requests

from database import get_db, _lock, execute_write

NOMINATIM = "https://nominatim.openstreetmap.org/search"
HEADERS   = {"User-Agent": "PropIQ/1.0 (property investment research tool)"}


def geocode(name: str, metro: str) -> tuple[float, float] | None:
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


def run(metro_filter: str | None) -> None:
    filter_sql = "WHERE h3_7 IS NULL"
    params: list = []
    if metro_filter:
        filter_sql += " AND metro = ?"
        params.append(metro_filter)

    with _lock:
        props = get_db().execute(
            f"SELECT id, name, metro FROM neighborhoods {filter_sql}", params
        ).fetchall()

    total = len(props)
    if total == 0:
        print("Nothing to geocode — all neighbourhoods already have H3 indexes.")
        return

    print(f"Geocoding {total} neighbourhoods in: {metro_filter or 'ALL metros'}")
    print("Rate-limited to ~1 req/s per Nominatim policy.\n")

    ok = skipped = 0
    for i, (pid, name, metro) in enumerate(props, 1):
        result = geocode(name, metro or "")
        if result:
            lat, lng = result
            h3_7 = h3.latlng_to_cell(lat, lng, 7)
            h3_9 = h3.latlng_to_cell(lat, lng, 9)
            execute_write(
                "UPDATE neighborhoods SET lat=?, lng=?, h3_7=?, h3_9=? WHERE id=?",
                [lat, lng, h3_7, h3_9, pid],
            )
            ok += 1
            print(f"[{i}/{total}] ✓  {name:40s}  h3_7={h3_7}  h3_9={h3_9}")
        else:
            skipped += 1
            print(f"[{i}/{total}] ✗  {name} — not found")
        time.sleep(1.1)

    print(f"\nDone: {ok} geocoded, {skipped} skipped.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 geocode_neighborhoods.py \"Denver, CO metro area\"")
        print("       python3 geocode_neighborhoods.py --all")
        sys.exit(1)
    run(None if sys.argv[1] == "--all" else sys.argv[1])
