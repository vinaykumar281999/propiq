"""PropIQ FastAPI backend — DuckDB edition."""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import h3 as h3lib
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import loader
from database import get_db, _lock
from models import Neighborhood, Amenity, CensusTract
import agent

# Initialise DuckDB (creates schema on first call)
get_db()

app = FastAPI(title="PropIQ API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://192.168.4.40:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class OptimizeRequest(BaseModel):
    budget: int

class AskRequest(BaseModel):
    question: str
    include_context: bool = True

class LoadRequest(BaseModel):
    source: str = "neighborhoods"  # "neighborhoods" | "cities"


# ── helpers ───────────────────────────────────────────────────────────────────

def _nbhd_rows(sql: str, params: list | None = None) -> list[dict]:
    with _lock:
        rows = get_db().execute(sql, params or []).fetchall()
    return [Neighborhood.from_row(r).to_dict() for r in rows]

_NBHD_SELECT = (
    "SELECT id, name, metro, price, expected_return, "
    "days_on_market, lat, lng, h3_7, h3_9 FROM neighborhoods"
)


# ── neighbourhood endpoints ───────────────────────────────────────────────────

@app.get("/api/v1/properties", response_model=None)
def list_properties(
    limit: int = Query(default=100, le=10000),
    offset: int = 0,
):
    with _lock:
        total = get_db().execute("SELECT COUNT(*) FROM neighborhoods").fetchone()[0]
        rows  = get_db().execute(
            f"{_NBHD_SELECT} LIMIT ? OFFSET ?", [limit, offset]
        ).fetchall()
    return {
        "total":      total,
        "properties": [Neighborhood.from_row(r).to_dict() for r in rows],
    }


@app.get("/api/v1/properties/{property_id}", response_model=None)
def get_property(property_id: int):
    with _lock:
        row = get_db().execute(
            f"{_NBHD_SELECT} WHERE id = ?", [property_id]
        ).fetchone()
    if not row:
        raise HTTPException(404, "Property not found")
    return Neighborhood.from_row(row).to_dict()


@app.get("/api/v1/metros", response_model=None)
def list_metros():
    with _lock:
        rows = get_db().execute(
            "SELECT DISTINCT metro FROM neighborhoods "
            "WHERE metro IS NOT NULL ORDER BY metro"
        ).fetchall()
    return {"metros": [r[0] for r in rows]}


# ── amenity endpoints ─────────────────────────────────────────────────────────

@app.get("/api/v1/amenities", response_model=None)
def get_amenities(
    lat: float = Query(...),
    lng: float = Query(...),
    type: str = Query("gas_station"),
    radius_km: float = Query(2.0, ge=0.1, le=20.0),
):
    """Return amenities within radius_km of (lat, lng) for a given type."""
    # H3 res-9 edge ≈ 0.174 km → rings = ceil(radius / edge)
    rings = max(1, min(30, round(radius_km / 0.174)))
    center = h3lib.latlng_to_cell(lat, lng, 9)
    cells  = list(h3lib.grid_disk(center, rings))

    ph = ",".join(["?" for _ in cells])
    with _lock:
        rows = get_db().execute(
            f"SELECT id, osm_id, type, name, lat, lng, h3_7, h3_9 "
            f"FROM amenities WHERE h3_9 IN ({ph}) AND type = ?",
            cells + [type],
        ).fetchall()

    return {
        "amenities": [Amenity.from_row(r).to_dict() for r in rows],
        "count":     len(rows),
    }


@app.get("/api/v1/amenities/all", response_model=None)
def amenities_all(
    sw_lat: float = Query(...),
    sw_lng: float = Query(...),
    ne_lat: float = Query(...),
    ne_lng: float = Query(...),
    types:  str   = Query("gas_station,school,hospital"),
):
    """Return all amenities in a bounding box (for map display)."""
    type_list = [t.strip() for t in types.split(",")]
    ph = ",".join(["?" for _ in type_list])
    with _lock:
        rows = get_db().execute(
            f"SELECT id, osm_id, type, name, lat, lng, h3_7, h3_9 "
            f"FROM amenities "
            f"WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? "
            f"  AND type IN ({ph})",
            [sw_lat, ne_lat, sw_lng, ne_lng] + type_list,
        ).fetchall()
    return {
        "amenities": [Amenity.from_row(r).to_dict() for r in rows],
        "count":     len(rows),
    }


# ── demographics endpoints ────────────────────────────────────────────────────

def _h3_cell_to_wkt(h3_7: str) -> str:
    """Convert an H3-7 cell to a WKT POLYGON string (lng lat coordinate order)."""
    boundary = h3lib.cell_to_boundary(h3_7)  # [(lat, lng), ...]
    ring = [(lng, lat) for lat, lng in boundary]
    ring.append(ring[0])  # close the ring
    return f"POLYGON(({', '.join(f'{c[0]} {c[1]}' for c in ring)}))"


@app.get("/api/v1/demographics", response_model=None)
def get_demographics(
    neighborhood: str = Query(...),
    metro: str | None = Query(None),
):
    """Return aggregated census demographics for a neighbourhood's H3 area.

    Uses DuckDB spatial ST_Intersects when TIGER polygon geometries are loaded
    (demographics_loader.py has been run). Falls back to H3 proximity otherwise.
    """
    with _lock:
        row = get_db().execute(
            "SELECT h3_7 FROM neighborhoods WHERE name = ?", [neighborhood]
        ).fetchone()

    if not row or not row[0]:
        raise HTTPException(404, "Neighbourhood not found or not yet geocoded")

    h3_7 = row[0]

    # Prefer DuckDB spatial ST_Intersects on stored TIGER polygon geometries
    with _lock:
        has_geom = get_db().execute(
            "SELECT COUNT(*) FROM census_tracts WHERE geom IS NOT NULL"
        ).fetchone()[0]

    if has_geom:
        h3_wkt = _h3_cell_to_wkt(h3_7)
        with _lock:
            tracts = get_db().execute(
                "SELECT total_pop, pop_under_18, median_income "
                "FROM census_tracts "
                "WHERE geom IS NOT NULL "
                "  AND ST_Intersects(ST_GeomFromText(geom), ST_GeomFromText(?))",
                [h3_wkt],
            ).fetchall()
    else:
        # Fallback: H3 proximity search (ring-1 neighbours)
        cells = list(h3lib.grid_disk(h3_7, 1))
        ph    = ",".join(["?" for _ in cells])
        with _lock:
            tracts = get_db().execute(
                f"SELECT total_pop, pop_under_18, median_income "
                f"FROM census_tracts WHERE h3_7 IN ({ph})",
                cells,
            ).fetchall()

    if not tracts:
        return {
            "neighborhood": neighborhood,
            "data":         None,
            "note":         "No census data loaded for this area. Run demographics_loader.py first.",
        }

    pops    = [r[0] for r in tracts if r[0] and r[0] > 0]
    u18s    = [r[1] for r in tracts if r[1] and r[1] > 0]
    incomes = [r[2] for r in tracts if r[2] and r[2] > 0]

    avg_pop     = round(sum(pops)    / len(pops))    if pops    else None
    avg_u18     = round(sum(u18s)    / len(u18s))    if u18s    else None
    avg_income  = round(sum(incomes) / len(incomes)) if incomes else None
    pct_u18     = round(avg_u18 / avg_pop * 100, 1)  if (avg_pop and avg_u18) else None

    return {
        "neighborhood": neighborhood,
        "data": {
            "total_pop":     avg_pop,
            "pop_under_18":  avg_u18,
            "pct_under_18":  pct_u18,
            "median_income": avg_income,
            "tract_count":   len(tracts),
        },
    }


@app.get("/api/v1/demographics/batch", response_model=None)
def demographics_batch():
    """Return all H3-7 → demographics for the map demographic overlay."""
    with _lock:
        rows = get_db().execute(
            "SELECT h3_7, total_pop, pop_under_18, median_income "
            "FROM census_tracts WHERE h3_7 IS NOT NULL"
        ).fetchall()

    result: dict[str, dict] = {}
    for h3_7, total_pop, pop_u18, income in rows:
        if h3_7 in result:
            # Multiple tracts in same H3 cell → average
            prev = result[h3_7]
            prev["_count"]      += 1
            prev["total_pop"]    = (prev.get("total_pop", 0) or 0)  + (total_pop or 0)
            prev["pop_under_18"] = (prev.get("pop_under_18", 0) or 0) + (pop_u18 or 0)
            prev["median_income"]= (prev.get("median_income", 0) or 0) + (income or 0)
        else:
            result[h3_7] = {
                "_count":       1,
                "total_pop":    total_pop or 0,
                "pop_under_18": pop_u18 or 0,
                "median_income":income or 0,
            }

    # Finalise averages
    for cell, d in result.items():
        cnt = d.pop("_count")
        if cnt > 1:
            d["total_pop"]     = round(d["total_pop"]     / cnt)
            d["pop_under_18"]  = round(d["pop_under_18"]  / cnt)
            d["median_income"] = round(d["median_income"] / cnt)
        tp = d.get("total_pop") or 0
        u  = d.get("pop_under_18") or 0
        d["pct_under_18"] = round(u / tp * 100, 1) if tp and u else None

    return {"demographics": result, "count": len(result)}


# ── H3 spatial endpoints ──────────────────────────────────────────────────────

@app.get("/api/v1/h3/neighbors", response_model=None)
def h3_neighbors(
    h3_index: str = Query(...),
    rings:    int = Query(2, ge=1, le=5),
):
    """Return all neighbourhoods within `rings` H3 grid rings."""
    try:
        cells = list(h3lib.grid_disk(h3_index, rings))
    except Exception:
        raise HTTPException(400, "Invalid H3 index")

    ph = ",".join(["?" for _ in cells])
    with _lock:
        rows = get_db().execute(
            f"{_NBHD_SELECT} WHERE h3_7 IN ({ph})", cells
        ).fetchall()

    return {
        "h3_index":      h3_index,
        "rings":         rings,
        "cells":         cells,
        "neighborhoods": [Neighborhood.from_row(r).to_dict() for r in rows],
    }


# ── admin data-load endpoints ─────────────────────────────────────────────────

@app.post("/api/v1/load", response_model=None)
def load_data(body: LoadRequest):
    if body.source not in ("neighborhoods", "cities"):
        raise HTTPException(400, "source must be 'neighborhoods' or 'cities'")
    try:
        n = loader.load(body.source)
        return {"loaded": n, "source": body.source}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.post("/api/v1/load/amenities", response_model=None)
def load_amenities():
    """Fetch OSM amenities via Overpass and populate the amenities table."""
    try:
        import amenities_loader
        n = amenities_loader.load()
        return {"loaded": n}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/v1/load/demographics", response_model=None)
def load_demographics(api_key: str | None = Query(None)):
    """Fetch Census ACS demographics and populate the census_tracts table."""
    try:
        import demographics_loader
        n = demographics_loader.load(api_key)
        return {"loaded": n}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── portfolio optimisation ────────────────────────────────────────────────────

@app.post("/api/v1/optimize", response_model=None)
def optimize(body: OptimizeRequest):
    with _lock:
        rows = get_db().execute(
            "SELECT id, name, price, expected_return FROM neighborhoods"
        ).fetchall()

    if not rows:
        raise HTTPException(422, "No properties in database. Load data first.")

    items = [
        {"id": r[0], "name": r[1], "price": int(r[2]), "expected_return": int(r[3])}
        for r in rows
        if r[2] <= body.budget and r[3] > 0
    ]
    items_sorted = sorted(items, key=lambda x: x["expected_return"] / x["price"], reverse=True)
    selected, remaining = [], body.budget
    for item in items_sorted:
        if item["price"] <= remaining:
            selected.append(item)
            remaining -= item["price"]

    total_invested = body.budget - remaining
    total_return   = sum(i["expected_return"] for i in selected)

    return {
        "budget":                body.budget,
        "total_invested":        total_invested,
        "remaining_budget":      remaining,
        "total_expected_return": total_return,
        "portfolio_roi_pct":     round(total_return / total_invested * 100, 2) if total_invested else 0,
        "properties":            selected,
        "properties_count":      len(selected),
    }


# ── AI advisor ────────────────────────────────────────────────────────────────

@app.post("/api/v1/ask", response_model=None)
def ask_advisor(body: AskRequest):
    context: str | None = None
    if body.include_context:
        with _lock:
            sample = get_db().execute(
                "SELECT name, price, expected_return FROM neighborhoods LIMIT 20"
            ).fetchall()
        context = json.dumps(
            [{"name": r[0], "price": r[1], "expected_return": r[2]} for r in sample],
            indent=2,
        )
    return {"answer": agent.ask(body.question, context)}


@app.post("/api/v1/ask/stream", response_model=None)
def ask_advisor_stream(body: AskRequest):
    context: str | None = None
    if body.include_context:
        with _lock:
            sample = get_db().execute(
                "SELECT name, price, expected_return FROM neighborhoods LIMIT 20"
            ).fetchall()
        context = json.dumps(
            [{"name": r[0], "price": r[1], "expected_return": r[2]} for r in sample],
            indent=2,
        )

    def generate():
        for chunk in agent.stream_ask(body.question, context):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/v1/analyze", response_model=None)
def analyze(body: OptimizeRequest):
    opt = optimize(body)
    analysis = agent.analyze_portfolio(opt["properties"], body.budget)
    return {**opt, "ai_analysis": analysis}


# ── health ────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=None)
def health():
    with _lock:
        n = get_db().execute("SELECT COUNT(*) FROM neighborhoods").fetchone()[0]
    return {"status": "ok", "neighborhoods": n}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, workers=1)
