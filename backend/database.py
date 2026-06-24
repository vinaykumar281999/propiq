"""DuckDB connection management for PropIQ.

Connection strategy
-------------------
* One DuckDB file, opened with read_only=False.
* Each thread gets its own connection (threading.local pool), so concurrent
  reads don't serialize behind a single object.
* _write_lock serialises all mutations; DuckDB supports MVCC but concurrent
  bulk-writes from separate connections can still conflict.
* Schema initialisation runs exactly once across all threads.
* _lock is kept as a public alias for _write_lock so callers in main.py
  that already do `with _lock:` around reads work without changes — the
  extra locking on reads is harmless.

Multi-process note
------------------
DuckDB allows only one writer process per file. Run uvicorn with
workers=1 and no --reload flag. The reload watcher is itself a process
that would try to open the file and trigger the lock error.
"""
import os
import threading

import duckdb

DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../../propiq.duckdb")
)

# Per-thread connection pool.
_local = threading.local()

# Serialise all write operations across threads.
_write_lock = threading.Lock()

# Exposed alias — main.py imports `_lock`; keep it pointing at the write lock.
_lock = _write_lock

# Ensure schema DDL runs exactly once.
_schema_lock = threading.Lock()
_schema_done = False


def get_db() -> duckdb.DuckDBPyConnection:
    """Return the calling thread's connection, opening it on first call."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = _open(DB_PATH)
    return _local.conn


# ── internals ────────────────────────────────────────────────────────────────

def _open(path: str) -> duckdb.DuckDBPyConnection:
    c = duckdb.connect(path, read_only=False)
    _load_spatial(c)
    _ensure_schema(c)
    return c


def _load_spatial(c: duckdb.DuckDBPyConnection) -> None:
    try:
        c.execute("LOAD spatial")
    except Exception:
        try:
            c.execute("INSTALL spatial; LOAD spatial")
        except Exception as exc:
            print(f"[db] spatial extension unavailable ({exc})")


def _ensure_schema(c: duckdb.DuckDBPyConnection) -> None:
    global _schema_done
    with _schema_lock:
        if _schema_done:
            return
        _create_schema(c)
        _schema_done = True


# Index definitions per table — single source of truth so drop/recreate stay in sync.
_TABLE_INDEXES: dict[str, list[tuple[str, str]]] = {
    "neighborhoods": [
        ("idx_nbhd_metro", "neighborhoods(metro)"),
        ("idx_nbhd_h3",    "neighborhoods(h3_7)"),
        ("idx_nbhd_h3_9",  "neighborhoods(h3_9)"),
    ],
    "amenities": [
        ("idx_am_h3_9", "amenities(h3_9)"),
        ("idx_am_type", "amenities(type, h3_9)"),
    ],
    "census_tracts": [
        ("idx_tract_h3", "census_tracts(h3_7)"),
    ],
}


def _create_schema(c: duckdb.DuckDBPyConnection) -> None:
    tables = [
        # Neighbourhood-level investment data (from Redfin CSV)
        """CREATE TABLE IF NOT EXISTS neighborhoods (
            id              INTEGER PRIMARY KEY,
            name            VARCHAR NOT NULL,
            metro           VARCHAR,
            price           DOUBLE  NOT NULL,
            expected_return DOUBLE  NOT NULL,
            days_on_market  DOUBLE,
            lat             DOUBLE,
            lng             DOUBLE,
            h3_7            VARCHAR,
            h3_9            VARCHAR
        )""",
        # OSM amenities
        """CREATE TABLE IF NOT EXISTS amenities (
            id       INTEGER PRIMARY KEY,
            osm_id   BIGINT,
            type     VARCHAR NOT NULL,
            name     VARCHAR,
            lat      DOUBLE  NOT NULL,
            lng      DOUBLE  NOT NULL,
            h3_7     VARCHAR,
            h3_9     VARCHAR
        )""",
        # Census ACS 5-year demographics at tract level.
        # geom stores the WKT polygon boundary for DuckDB spatial ST_Intersects.
        """CREATE TABLE IF NOT EXISTS census_tracts (
            tract_id      VARCHAR PRIMARY KEY,
            county_fips   VARCHAR,
            total_pop     INTEGER,
            pop_under_18  INTEGER,
            median_income DOUBLE,
            lat           DOUBLE,
            lng           DOUBLE,
            h3_7          VARCHAR,
            geom          VARCHAR
        )""",
    ]
    for sql in tables:
        c.execute(sql)
    for entries in _TABLE_INDEXES.values():
        for name, cols in entries:
            try:
                c.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {cols}")
            except Exception:
                pass
    # Migrations for databases created before these columns were added
    for migration in [
        "ALTER TABLE neighborhoods ADD COLUMN h3_9 VARCHAR",
        "ALTER TABLE census_tracts ADD COLUMN geom VARCHAR",
    ]:
        try:
            c.execute(migration)
        except Exception:
            pass


def drop_indexes(table: str) -> None:
    """Drop all indexes for *table* before a bulk DELETE.

    DuckDB raises "Failed to delete all rows from index" when its ART index
    tries to update row-by-row during a large DELETE.  Dropping first and
    recreating after the INSERT avoids that entirely.
    """
    with _write_lock:
        conn = get_db()
        for name, _ in _TABLE_INDEXES.get(table, []):
            try:
                conn.execute(f"DROP INDEX IF EXISTS {name}")
            except Exception as exc:
                print(f"[db] drop index {name}: {exc}")
        conn.commit()


def recreate_indexes(table: str) -> None:
    """Recreate all indexes for *table* after a bulk INSERT."""
    with _write_lock:
        conn = get_db()
        for name, cols in _TABLE_INDEXES.get(table, []):
            try:
                conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {cols}")
            except Exception as exc:
                print(f"[db] create index {name}: {exc}")
        conn.commit()


def execute_write(sql: str, params: list | None = None) -> None:
    with _write_lock:
        conn = get_db()
        conn.execute(sql, params or [])
        conn.commit()


def executemany_write(sql: str, rows: list[tuple]) -> None:
    with _write_lock:
        conn = get_db()
        conn.executemany(sql, rows)
        conn.commit()
