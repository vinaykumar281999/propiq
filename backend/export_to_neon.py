"""Export PropIQ neighborhoods and amenities from DuckDB to Neon PostgreSQL.

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

# ── Neighborhoods ─────────────────────────────────────────────────────────────

_CREATE_NEIGHBORHOODS = """
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
_NBHD_MIGRATIONS = [
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS lat             DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS lng             DOUBLE PRECISION",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS h3_7            VARCHAR",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS h3_9            VARCHAR",
    "ALTER TABLE neighborhoods ADD COLUMN IF NOT EXISTS days_on_market  DOUBLE PRECISION",
]

_UPSERT_NBHD = """
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

# ── Amenities ─────────────────────────────────────────────────────────────────

_CREATE_AMENITIES = """
CREATE TABLE IF NOT EXISTS amenities (
    id     SERIAL PRIMARY KEY,
    osm_id VARCHAR,
    type   VARCHAR,
    name   VARCHAR,
    lat    DOUBLE PRECISION,
    lng    DOUBLE PRECISION,
    h3_7   VARCHAR,
    h3_9   VARCHAR
);
"""

_INSERT_AMENITY = """
INSERT INTO amenities (osm_id, type, name, lat, lng, h3_7, h3_9)
VALUES %s
ON CONFLICT DO NOTHING;
"""


def _export_neighborhoods(cur, pg) -> int:
    print("\nReading neighborhoods from DuckDB …")
    with _lock:
        rows = get_db().execute(
            "SELECT id, name, metro, price, expected_return, "
            "days_on_market, lat, lng, h3_7, h3_9 FROM neighborhoods "
            "ORDER BY id"
        ).fetchall()
    print(f"  {len(rows):,} rows found.")

    if not rows:
        print("  No neighborhood rows — skipping.")
        return 0

    print("Creating neighborhoods table (if not exists) …")
    cur.execute(_CREATE_NEIGHBORHOODS)
    pg.commit()

    print("Applying column migrations …")
    for sql in _NBHD_MIGRATIONS:
        cur.execute(sql)
    pg.commit()

    total, inserted = len(rows), 0
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        psycopg2.extras.execute_values(cur, _UPSERT_NBHD, batch)
        pg.commit()
        inserted += len(batch)
        print(f"  [{inserted / total * 100:5.1f}%]  {inserted:,} / {total:,} neighborhoods inserted")

    return inserted


def _export_amenities(cur, pg) -> int:
    print("\nReading amenities from DuckDB …")
    with _lock:
        rows = get_db().execute(
            "SELECT osm_id, type, name, lat, lng, h3_7, h3_9 FROM amenities ORDER BY id"
        ).fetchall()
    print(f"  {len(rows):,} rows found.")

    if not rows:
        print("  No amenity rows — skipping. Run load/amenities first.")
        return 0

    print("Creating amenities table (if not exists) …")
    cur.execute(_CREATE_AMENITIES)
    pg.commit()

    # Truncate so a re-run doesn't duplicate rows (amenities have no natural PK to conflict on)
    print("Truncating existing amenities …")
    cur.execute("TRUNCATE TABLE amenities RESTART IDENTITY")
    pg.commit()

    total, inserted = len(rows), 0
    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        psycopg2.extras.execute_values(cur, _INSERT_AMENITY, batch)
        pg.commit()
        inserted += len(batch)
        print(f"  [{inserted / total * 100:5.1f}%]  {inserted:,} / {total:,} amenities inserted")

    return inserted


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python3 export_to_neon.py <neon_connection_string>")
        sys.exit(1)

    conn_str = sys.argv[1]

    print("Connecting to Neon …")
    pg = psycopg2.connect(conn_str)
    cur = pg.cursor()
    print("  Connected.")

    n_nbhd     = _export_neighborhoods(cur, pg)
    n_amenity  = _export_amenities(cur, pg)

    cur.close()
    pg.close()
    print(f"\nDone. {n_nbhd:,} neighborhoods + {n_amenity:,} amenities exported to Neon.")


if __name__ == "__main__":
    main()
