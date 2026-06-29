"""
Sync lat/lng/h3_7/h3_9 coordinates from DuckDB → Neon.

DuckDB is the geocoding source of truth; Neon is what the Vercel app
queries. Running this script after a geocoding pass pushes all newly
computed coordinates to Neon so the map immediately shows the new hexagons.

Usage:
    python backend/sync_coords_to_neon.py
"""

import os
import sys

import duckdb
import psycopg2
import psycopg2.extras

# ── Paths & connection ────────────────────────────────────────────────────────

# database.py resolves DuckDB three levels above backend/
DUCK_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../propiq.duckdb")
)

NEON_DSN = (
    "postgresql://neondb_owner:npg_zYRIfy8EH0kG"
    "@ep-lively-wildflower-ah87fejj.c-3.us-east-1.aws.neon.tech"
    "/neondb?sslmode=require"
)

BATCH_SIZE   = 500
PRINT_EVERY  = 500


def fetch_from_duckdb() -> list[tuple]:
    """Return all neighborhoods that have coordinates as (id, lat, lng, h3_7, h3_9)."""
    if not os.path.exists(DUCK_PATH):
        sys.exit(f"DuckDB not found at {DUCK_PATH}")

    print(f"Reading DuckDB: {DUCK_PATH}")
    conn = duckdb.connect(DUCK_PATH, read_only=True)
    rows = conn.execute("""
        SELECT id, lat, lng, h3_7, h3_9
        FROM   neighborhoods
        WHERE  lat IS NOT NULL
          AND  lng IS NOT NULL
        ORDER  BY id
    """).fetchall()
    conn.close()
    print(f"  {len(rows):,} neighborhoods with coordinates in DuckDB")
    return rows


def sync_to_neon(rows: list[tuple]) -> None:
    total      = len(rows)
    neon_total = 0

    pg = psycopg2.connect(NEON_DSN)
    cur = pg.cursor()

    # How many Neon rows already have coordinates
    cur.execute("SELECT COUNT(*) FROM neighborhoods WHERE lat IS NOT NULL")
    already = cur.fetchone()[0]
    print(f"  Neon currently has {already:,} rows with coordinates (out of "
          f"{_neon_total(cur):,} total)\n")

    updated = 0
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        psycopg2.extras.execute_batch(
            cur,
            """
            UPDATE neighborhoods
               SET lat   = %(lat)s,
                   lng   = %(lng)s,
                   h3_7  = %(h3_7)s,
                   h3_9  = %(h3_9)s
             WHERE id    = %(id)s
            """,
            [
                {"id": r[0], "lat": r[1], "lng": r[2], "h3_7": r[3], "h3_9": r[4]}
                for r in batch
            ],
            page_size=BATCH_SIZE,
        )
        pg.commit()
        updated += len(batch)

        if updated % PRINT_EVERY == 0 or updated == total:
            print(f"  Progress: {updated:,} / {total:,} rows synced …")

    cur.close()
    pg.close()

    neon_total = total   # all rows we sent
    print(f"\nUpdated {updated:,}/{total:,} neighborhoods with coordinates")


def _neon_total(cur) -> int:
    cur.execute("SELECT COUNT(*) FROM neighborhoods")
    return cur.fetchone()[0]


if __name__ == "__main__":
    rows = fetch_from_duckdb()
    if not rows:
        print("Nothing to sync — no coordinates in DuckDB yet.")
        sys.exit(0)
    sync_to_neon(rows)
