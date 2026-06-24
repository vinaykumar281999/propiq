"""Export PropIQ neighborhoods from DuckDB to Neon PostgreSQL.

Usage:
    python3 export_to_neon.py "postgresql://user:pass@host/db?sslmode=require"
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import psycopg2
import psycopg2.extras

from database import get_db, _lock

BATCH_SIZE = 500

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS neighborhoods (
    id              INTEGER PRIMARY KEY,
    name            VARCHAR        NOT NULL,
    metro           VARCHAR,
    price           DOUBLE PRECISION NOT NULL,
    expected_return DOUBLE PRECISION NOT NULL,
    days_on_market  DOUBLE PRECISION,
    lat             DOUBLE PRECISION,
    lng             DOUBLE PRECISION,
    h3_7            VARCHAR,
    h3_9            VARCHAR
);
"""

# Add missing columns to tables created by older versions of this script.
_MIGRATIONS = [
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS lat             DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS lng             DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS h3_7            VARCHAR",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS h3_9            VARCHAR",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS days_on_market  DOUBLE PRECISION",
]

_UPSERT = """
INSERT INTO neighborhoods
    (id, name, metro, price, expected_return, days_on_market, lat, lng, h3_7, h3_9)
VALUES %s
ON CONFLICT (id) DO UPDATE SET
    name            = EXCLUDED.name,
    metro           = EXCLUDED.metro,
    price           = EXCLUDED.price,
    expected_return = EXCLUDED.expected_return,
    days_on_market  = EXCLUDED.days_on_market,
    lat             = EXCLUDED.lat,
    lng             = EXCLUDED.lng,
    h3_7            = EXCLUDED.h3_7,
    h3_9            = EXCLUDED.h3_9;
"""


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 export_to_neon.py <neon_connection_string>")
        sys.exit(1)

    conn_str = sys.argv[1]

    # ── 1. Read from DuckDB ───────────────────────────────────────────────────
    print("Reading neighborhoods from DuckDB …")
    with _lock:
        rows = get_db().execute(
            "SELECT id, name, metro, price, expected_return, "
            "days_on_market, lat, lng, h3_7, h3_9 FROM neighborhoods "
            "ORDER BY id"
        ).fetchall()
    print(f"  {len(rows):,} rows found.")

    if not rows:
        print("Nothing to export.")
        sys.exit(0)

    # ── 2. Connect to Neon ────────────────────────────────────────────────────
    print("Connecting to Neon …")
    pg = psycopg2.connect(conn_str)
    cur = pg.cursor()
    print("  Connected.")

    # ── 3. Create table + migrate any missing columns ─────────────────────────
    print("Creating neighborhoods table (if not exists) …")
    cur.execute(_CREATE_TABLE)
    pg.commit()

    print("Applying column migrations …")
    for sql in _MIGRATIONS:
        cur.execute(sql)
    pg.commit()

    # ── 4. Insert in batches with progress ───────────────────────────────────
    total = len(rows)
    inserted = 0

    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        psycopg2.extras.execute_values(cur, _UPSERT, batch)
        pg.commit()
        inserted += len(batch)
        pct = inserted / total * 100
        print(f"  [{pct:5.1f}%]  {inserted:,} / {total:,} rows inserted")

    cur.close()
    pg.close()
    print(f"\nDone. {inserted:,} neighborhoods exported to Neon.")


if __name__ == "__main__":
    main()
