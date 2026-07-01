"""Refresh the Neon `neighborhoods` table from Redfin's public data lake.

Note on the source file: the roadmap's original URL
(redfin_metro_market_tracker.tsv000.gz) is Redfin's *metro*-level tracker —
its REGION_TYPE is "metro" and its REGION values look like "Tacoma, WA metro
area", not neighborhoods. This script instead pulls the neighborhood-level
file (REGION_TYPE == "neighborhood") from the same public bucket, whose
REGION values look like "Denver, CO - Cherry Creek".

That file is large (~2.3GB compressed, tens of millions of rows across every
neighborhood x property type x month since ~2012), so this streams the
gzip decompression and keeps only the single most recent month per
neighborhood (property type "All Residential") rather than loading
everything into memory.

Usage:
    python3 refresh_redfin.py [neon_connection_string]

If no connection string is passed, DATABASE_URL is read from the environment.
"""
import csv
import gzip
import os
import sys
import time

import psycopg2
import psycopg2.extras
import requests

SOURCE_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_market_tracker/neighborhood_market_tracker.tsv000.gz"
)
DOWNLOAD_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../data/.redfin_neighborhood_market_tracker.tsv000.gz")
)
# PRICE_DROPS is never populated at neighborhood granularity in the file above
# (confirmed: 0 non-NA values across a 3M-row sample) — Redfin only computes it
# at metro granularity or coarser. Pull that instead and join it onto each
# neighborhood by metro, so the price-cut feature uses real (if less granular)
# data instead of going permanently empty.
METRO_SOURCE_URL = (
    "https://redfin-public-data.s3.us-west-2.amazonaws.com/"
    "redfin_market_tracker/redfin_metro_market_tracker.tsv000.gz"
)
METRO_DOWNLOAD_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../data/.redfin_metro_market_tracker.tsv000.gz")
)
PROPERTY_TYPE_FILTER = "All Residential"
MIN_HOMES_SOLD        = 5
BATCH_SIZE            = 500
PROGRESS_EVERY_ROWS   = 2_000_000

MIGRATIONS = [
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS price_drops      DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS inventory        DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS homes_sold       DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS months_of_supply DOUBLE PRECISION",
]


# ── Download ───────────────────────────────────────────────────────────────────

def download(url: str, path: str) -> None:
    head = requests.head(url, timeout=30)
    remote_size = int(head.headers.get("content-length", 0))

    if os.path.exists(path) and os.path.getsize(path) == remote_size and remote_size > 0:
        print(f"Using cached download at {path} ({remote_size / 1e9:.2f}GB, size matches remote).")
        return

    print(f"Downloading {url} ({remote_size / 1e9:.2f}GB) …")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    t0 = time.time()
    tmp_path = path + ".part"
    try:
        with requests.get(url, stream=True, timeout=120) as r:
            r.raise_for_status()
            written = 0
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
                    written += len(chunk)
                    if remote_size:
                        pct = written / remote_size * 100
                        print(f"\r  {written / 1e9:.2f}GB / {remote_size / 1e9:.2f}GB ({pct:5.1f}%)", end="", flush=True)
        os.replace(tmp_path, path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise
    print(f"\nDownload complete in {time.time() - t0:.0f}s.")


# ── Parsing ────────────────────────────────────────────────────────────────────

def _parse_region(region: str) -> tuple[str, str] | None:
    """Split "City, ST - Neighborhood Name" into (neighborhood_name, metro).

    The source file's metro part is bare ("Denver, CO"), but the table's
    existing convention (and the frontend's hardcoded default metro) is
    "Denver, CO metro area" — normalise so a metro doesn't fragment into two
    entries in the metro filter dropdown.
    """
    if " - " not in region:
        return None
    metro_part, name = region.split(" - ", 1)
    name = name.strip()
    metro_part = metro_part.strip()
    if metro_part and not metro_part.lower().endswith(("metro area", "micro area")):
        metro_part += " metro area"
    return (name, metro_part) if name else None


def _num(v: str | None) -> float | None:
    if v in (None, "", "NA"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def stream_latest_rows(path: str) -> dict[str, dict]:
    """Single pass over the TSV, keeping only the most recent period per
    neighborhood name so memory stays bounded to O(#neighborhoods)."""
    latest: dict[str, dict] = {}
    t0 = time.time()
    n_rows = 0

    with gzip.open(path, "rt", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quotechar='"')
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}

        req = ["REGION_TYPE", "PROPERTY_TYPE", "REGION", "PERIOD_END",
               "MEDIAN_SALE_PRICE", "MEDIAN_SALE_PRICE_YOY", "HOMES_SOLD",
               "MEDIAN_DOM", "PRICE_DROPS", "INVENTORY", "MONTHS_OF_SUPPLY"]
        missing = [c for c in req if c not in idx]
        if missing:
            raise RuntimeError(f"Expected columns missing from source file: {missing}")

        for row in reader:
            n_rows += 1
            if n_rows % PROGRESS_EVERY_ROWS == 0:
                print(f"  scanned {n_rows / 1e6:.1f}M rows, "
                      f"{len(latest):,} neighborhoods kept so far, "
                      f"{time.time() - t0:.0f}s elapsed")

            if row[idx["REGION_TYPE"]] != "neighborhood":
                continue
            if row[idx["PROPERTY_TYPE"]] != PROPERTY_TYPE_FILTER:
                continue

            parsed = _parse_region(row[idx["REGION"]])
            if not parsed:
                continue
            name, metro = parsed

            period_end = row[idx["PERIOD_END"]]
            existing = latest.get(name)
            if existing and existing["period_end"] >= period_end:
                continue

            price = _num(row[idx["MEDIAN_SALE_PRICE"]])
            homes_sold = _num(row[idx["HOMES_SOLD"]]) or 0.0
            if price is None or price <= 0 or homes_sold < MIN_HOMES_SOLD:
                continue

            yoy = _num(row[idx["MEDIAN_SALE_PRICE_YOY"]]) or 0.0
            expected_return = price * yoy
            if expected_return <= 0:
                continue

            inventory = _num(row[idx["INVENTORY"]])
            # Redfin's own MONTHS_OF_SUPPLY is never populated at neighborhood
            # granularity either, so compute it from inventory / monthly sales
            # rate directly (same formula, using fields that ARE available here).
            months_of_supply = _num(row[idx["MONTHS_OF_SUPPLY"]])
            if months_of_supply is None and inventory is not None and homes_sold > 0:
                months_of_supply = inventory / homes_sold

            latest[name] = {
                "period_end":       period_end,
                "metro":            metro,
                "price":            price,
                "expected_return":  expected_return,
                "days_on_market":   _num(row[idx["MEDIAN_DOM"]]),
                "price_drops":      None,  # not available at neighborhood granularity; joined from metro-level data below
                "inventory":        inventory,
                "homes_sold":       homes_sold,
                "months_of_supply": months_of_supply,
            }

    print(f"  Done scanning {n_rows / 1e6:.1f}M rows in {time.time() - t0:.0f}s "
          f"— {len(latest):,} neighborhoods kept.")
    return latest


def stream_metro_price_drops(path: str) -> dict[str, float]:
    """Latest PRICE_DROPS per metro (property type "All Residential"),
    keyed by the same "City, ST metro area" convention used for neighborhoods.metro."""
    latest: dict[str, tuple[str, float]] = {}
    with gzip.open(path, "rt", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quotechar='"')
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}

        for row in reader:
            if row[idx["REGION_TYPE"]] != "metro":
                continue
            if row[idx["PROPERTY_TYPE"]] != PROPERTY_TYPE_FILTER:
                continue
            region = row[idx["REGION"]].strip()
            if not region:
                continue
            price_drops = _num(row[idx["PRICE_DROPS"]])
            if price_drops is None:
                continue
            period_end = row[idx["PERIOD_END"]]
            existing = latest.get(region)
            if existing and existing[0] >= period_end:
                continue
            latest[region] = (period_end, price_drops)

    print(f"  {len(latest):,} metros with price-drop data.")
    return {metro: v[1] for metro, v in latest.items()}


# ── Neon upsert ────────────────────────────────────────────────────────────────

def upsert(conn_str: str, data: dict[str, dict]) -> tuple[int, int]:
    pg = psycopg2.connect(conn_str)
    cur = pg.cursor()

    for migration in MIGRATIONS:
        cur.execute(migration)
    pg.commit()

    cur.execute("SELECT name, id FROM neighborhoods")
    existing_ids: dict[str, int] = {}
    for name, id_ in cur.fetchall():
        existing_ids.setdefault(name, id_)  # first id wins if duplicate names exist

    cur.execute("SELECT COALESCE(MAX(id), 0) FROM neighborhoods")
    next_id = cur.fetchone()[0] + 1

    update_rows: list[tuple] = []
    insert_rows: list[tuple] = []
    for name, d in data.items():
        if name in existing_ids:
            # Don't touch metro on existing rows — the source file's metro
            # string doesn't always match the app's existing convention for
            # the same city, and overwriting it can fragment the metro filter
            # (this happened once already: "Denver, CO metro area" -> "Denver, CO").
            update_rows.append((
                d["price"], d["expected_return"], d["days_on_market"],
                d["price_drops"], d["inventory"], d["homes_sold"], d["months_of_supply"],
                name,
            ))
        else:
            insert_rows.append((
                next_id, name, d["metro"], d["price"], d["expected_return"], d["days_on_market"],
                d["price_drops"], d["inventory"], d["homes_sold"], d["months_of_supply"],
            ))
            next_id += 1

    updated = 0
    for i in range(0, len(update_rows), BATCH_SIZE):
        batch = update_rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_values(
            cur,
            """
            UPDATE neighborhoods AS n SET
                price             = v.price,
                expected_return   = v.expected_return,
                days_on_market    = v.days_on_market,
                price_drops       = v.price_drops,
                inventory         = v.inventory,
                homes_sold        = v.homes_sold,
                months_of_supply  = v.months_of_supply
            FROM (VALUES %s) AS v(price, expected_return, days_on_market,
                                   price_drops, inventory, homes_sold, months_of_supply, name)
            WHERE n.name = v.name
            """,
            batch,
            # execute_values otherwise infers a bare VALUES list as all-text,
            # which Postgres then refuses to assign to double-precision columns.
            template="(%s::double precision, %s::double precision, %s::double precision, "
                     "%s::double precision, %s::double precision, %s::double precision, "
                     "%s::double precision, %s)",
        )
        pg.commit()
        updated += len(batch)
        print(f"  updated {updated:,}/{len(update_rows):,}")

    inserted = 0
    for i in range(0, len(insert_rows), BATCH_SIZE):
        batch = insert_rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO neighborhoods
                (id, name, metro, price, expected_return, days_on_market,
                 price_drops, inventory, homes_sold, months_of_supply)
            VALUES %s
            """,
            batch,
        )
        pg.commit()
        inserted += len(batch)
        print(f"  inserted {inserted:,}/{len(insert_rows):,}")

    cur.close()
    pg.close()
    return updated, inserted


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    conn_str = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("DATABASE_URL")
    if not conn_str:
        sys.exit("Usage: python3 refresh_redfin.py [neon_connection_string]  (or set DATABASE_URL)")

    download(SOURCE_URL, DOWNLOAD_PATH)
    data = stream_latest_rows(DOWNLOAD_PATH)

    print("\nFetching metro-level price-drop data (not available at neighborhood granularity) …")
    download(METRO_SOURCE_URL, METRO_DOWNLOAD_PATH)
    metro_price_drops = stream_metro_price_drops(METRO_DOWNLOAD_PATH)
    matched = 0
    for d in data.values():
        pd = metro_price_drops.get(d["metro"])
        if pd is not None:
            d["price_drops"] = pd
            matched += 1
    print(f"  {matched:,}/{len(data):,} neighborhoods matched to a metro price-drop figure.")

    updated, inserted = upsert(conn_str, data)

    print(f"\nDone. {updated:,} neighborhoods updated, {inserted:,} new.")


if __name__ == "__main__":
    main()
