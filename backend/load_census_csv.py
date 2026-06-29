"""
Load 2024 ACS census data (S0101) for Denver County, Aurora, and Lakewood
into the city_demographics table in Neon.

Usage:
  python backend/load_census_csv.py <path_to_csv>

If no path is supplied it tries the default Downloads location.
"""

import csv
import sys
import re
import psycopg2

DB_URL = (
    "postgresql://neondb_owner:npg_zYRIfy8EH0kG"
    "@ep-lively-wildflower-ah87fejj.c-3.us-east-1.aws.neon.tech"
    "/neondb?sslmode=require"
)

DEFAULT_CSV = (
    "/Users/vinaykumarsundarapalli/Downloads/"
    "ACSST1Y2024.S0101-2026-06-29T154508.csv"
)

# ── Column indices (0-based) for each city's Total Estimate ──────────────────
# Header: col 1 = Denver County Total Estimate
#         col 13 = Aurora Total Estimate
#         col 25 = Lakewood Total Estimate
CITY_COL = {
    "Denver County": 1,
    "Aurora":        13,
    "Lakewood":      25,
}

# Row indices (0-based, after header) in the CSV body
ROW_TOTAL_POP  = 1   # "Total population"
ROW_UNDER_18   = 24  # "Under 18 years"
ROW_MEDIAN_AGE = 35  # "Median age (years)"


def parse_number(raw: str) -> float | None:
    """Strip commas, %, and whitespace; return float or None."""
    cleaned = re.sub(r"[,%]", "", raw.strip())
    try:
        return float(cleaned)
    except ValueError:
        return None


def load(csv_path: str) -> None:
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))

    records: list[dict] = []
    for city, col in CITY_COL.items():
        total_pop  = parse_number(rows[ROW_TOTAL_POP][col])
        under_18   = parse_number(rows[ROW_UNDER_18][col])
        median_age = parse_number(rows[ROW_MEDIAN_AGE][col])

        if total_pop is None or total_pop == 0:
            print(f"  WARNING: no total population for {city}, skipping.")
            continue

        youth_pct = round((under_18 / total_pop) * 100, 2) if under_18 else None

        records.append({
            "city":               city,
            "total_population":   int(total_pop),
            "population_under_18": int(under_18) if under_18 else None,
            "youth_pct":          youth_pct,
            "median_age":         median_age,
        })

    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS city_demographics (
            city                 VARCHAR PRIMARY KEY,
            total_population     INTEGER,
            population_under_18  INTEGER,
            youth_pct            DOUBLE PRECISION,
            median_age           DOUBLE PRECISION
        )
    """)

    for r in records:
        cur.execute("""
            INSERT INTO city_demographics
                (city, total_population, population_under_18, youth_pct, median_age)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (city) DO UPDATE SET
                total_population    = EXCLUDED.total_population,
                population_under_18 = EXCLUDED.population_under_18,
                youth_pct           = EXCLUDED.youth_pct,
                median_age          = EXCLUDED.median_age
        """, (
            r["city"],
            r["total_population"],
            r["population_under_18"],
            r["youth_pct"],
            r["median_age"],
        ))
        print(
            f"  Inserted: {r['city']}"
            f" — pop={r['total_population']:,}"
            f"  under18={r['population_under_18']:,}"
            f"  youth={r['youth_pct']}%"
            f"  median_age={r['median_age']}"
        )

    conn.commit()
    cur.close()
    conn.close()
    print(f"\nDone. {len(records)} cities loaded into city_demographics.")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
    print(f"Reading: {path}")
    load(path)
