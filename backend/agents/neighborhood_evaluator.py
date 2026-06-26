"""
Multi-step Neighborhood Evaluator Agent for PropIQ.

Uses Claude's tool-calling API as an autonomous agent that:
1. Gathers price data from DuckDB
2. Queries OpenStreetMap Overpass API for nearby amenities
3. Calculates proximity scores across 5 investment dimensions
4. Synthesizes a natural-language evaluation with investment verdict
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import json
import math
import requests
import anthropic

from database import get_connection

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_HEADERS = {"User-Agent": "PropIQ/1.0 neighborhood evaluator"}


# ── Geometry helpers ───────────────────────────────────────────────────────────

def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Agent class ────────────────────────────────────────────────────────────────

class NeighborhoodEvaluatorAgent:

    def __init__(self):
        self.client = anthropic.Anthropic()
        self.tools = self._define_tools()

    # ── Tool schema definitions ────────────────────────────────────────────────

    def _define_tools(self) -> list[dict]:
        return [
            {
                "name": "get_house_prices",
                "description": (
                    "Fetch current price, expected return, and days-on-market data for a "
                    "neighborhood from the PropIQ DuckDB database."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "neighborhood": {
                            "type": "string",
                            "description": "Neighborhood name (partial match supported)",
                        }
                    },
                    "required": ["neighborhood"],
                },
            },
            {
                "name": "get_nearby_amenities",
                "description": (
                    "Query OpenStreetMap Overpass API for amenities near a coordinate. "
                    "Returns a list of named locations with distances."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number", "description": "Latitude"},
                        "lng": {"type": "number", "description": "Longitude"},
                        "radius_km": {"type": "number", "description": "Search radius in km"},
                        "amenity_type": {
                            "type": "string",
                            "enum": ["school", "healthcare", "lifestyle", "premium"],
                            "description": (
                                "school=schools/universities; healthcare=hospitals/clinics/pharmacies; "
                                "lifestyle=restaurants/cafes/gyms/parks/supermarkets; "
                                "premium=waterways/golf/transit/large-parks"
                            ),
                        },
                    },
                    "required": ["lat", "lng", "radius_km", "amenity_type"],
                },
            },
            {
                "name": "calculate_proximity_score",
                "description": (
                    "Calculate a dimension score (0–25 for price, 0–20 for school/lifestyle/premium, "
                    "0–15 for healthcare) based on distance-weighted scoring rules."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number"},
                        "lng": {"type": "number"},
                        "locations": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "lat": {"type": "number"},
                                    "lng": {"type": "number"},
                                    "name": {"type": "string"},
                                    "type": {"type": "string"},
                                    "distance_km": {"type": "number"},
                                },
                            },
                        },
                        "dimension": {
                            "type": "string",
                            "enum": ["school", "healthcare", "lifestyle", "premium"],
                        },
                    },
                    "required": ["lat", "lng", "locations", "dimension"],
                },
            },
            {
                "name": "get_price_trend",
                "description": (
                    "Calculate price appreciation metrics for a neighborhood using available "
                    "database data. Returns ROI%, days-on-market, and a trend summary."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "neighborhood": {"type": "string"},
                    },
                    "required": ["neighborhood"],
                },
            },
            {
                "name": "identify_value_drivers",
                "description": (
                    "Autonomously query OpenStreetMap to find premium value-adding features: "
                    "waterways, golf courses, large named parks, transit stations, universities. "
                    "Returns a list of identified value drivers."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "lat": {"type": "number"},
                        "lng": {"type": "number"},
                    },
                    "required": ["lat", "lng"],
                },
            },
        ]

    # ── Tool implementations ───────────────────────────────────────────────────

    def get_house_prices(self, neighborhood: str) -> dict:
        try:
            conn = get_connection()
            row = conn.execute(
                """
                SELECT name, price, expected_return, days_on_market
                FROM   neighborhoods
                WHERE  LOWER(name) LIKE LOWER(?)
                LIMIT  1
                """,
                [f"%{neighborhood}%"],
            ).fetchone()

            if not row:
                return {"found": False, "neighborhood": neighborhood, "error": "Not in database"}

            price = float(row[1] or 0)
            exp_return = float(row[2] or 0)
            roi_pct = round((exp_return / price * 100), 2) if price > 0 else 0

            return {
                "found": True,
                "neighborhood": row[0],
                "price": price,
                "expected_return_annual": exp_return,
                "roi_pct": roi_pct,
                "days_on_market": row[3],
                "data_period": "Jan–May 2026",
            }
        except Exception as e:
            return {"found": False, "error": str(e)}

    def get_price_trend(self, neighborhood: str) -> dict:
        data = self.get_house_prices(neighborhood)
        if not data.get("found"):
            return data

        roi = data["roi_pct"]
        dom = data.get("days_on_market")

        momentum = (
            "STRONG_UP" if roi >= 10 else
            "UP"        if roi >= 6  else
            "MODERATE"  if roi >= 3  else
            "FLAT"      if roi >= 0  else
            "DOWN"
        )

        demand = (
            "HIGH"     if dom is not None and dom < 20 else
            "MODERATE" if dom is not None and dom < 45 else
            "LOW"      if dom is not None else
            "UNKNOWN"
        )

        score = (
            25 if roi >= 15 else
            23 if roi >= 12 else
            21 if roi >= 10 else
            19 if roi >= 8  else
            16 if roi >= 6  else
            12 if roi >= 4  else
            8  if roi >= 2  else
            4  if roi > 0  else
            2
        )

        if dom is not None:
            if dom < 20:
                score = min(25, score + 2)
            elif dom > 60:
                score = max(0, score - 2)

        return {
            **data,
            "momentum": momentum,
            "demand": demand,
            "price_momentum_score": score,
            "trend_summary": f"+{roi}% YoY appreciation, {dom or 'N/A'} days on market",
        }

    def _overpass_query(self, query: str) -> list[dict]:
        try:
            res = requests.post(
                OVERPASS_URL,
                data={"data": query},
                headers=OVERPASS_HEADERS,
                timeout=30,
            )
            res.raise_for_status()
            return res.json().get("elements", [])
        except Exception:
            return []

    def _parse_elements(self, elements: list[dict], origin_lat: float, origin_lng: float) -> list[dict]:
        results = []
        for el in elements:
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lng = el.get("lon") or (el.get("center") or {}).get("lon")
            if not (lat and lng):
                continue
            tags = el.get("tags", {})
            name = (
                tags.get("name") or tags.get("amenity") or
                tags.get("leisure") or tags.get("shop") or
                tags.get("waterway") or tags.get("railway") or
                el["type"]
            )
            feat_type = (
                tags.get("amenity") or tags.get("leisure") or
                tags.get("shop") or tags.get("waterway") or
                tags.get("railway") or tags.get("public_transport") or
                tags.get("natural") or "unknown"
            )
            dist = haversine_km(origin_lat, origin_lng, lat, lng)
            results.append({
                "lat": lat, "lng": lng,
                "name": name, "type": feat_type,
                "distance_km": round(dist, 2),
            })
        results.sort(key=lambda x: x["distance_km"])
        return results

    def get_nearby_amenities(
        self, lat: float, lng: float, radius_km: float, amenity_type: str
    ) -> dict:
        r = int(radius_km * 1000)

        queries = {
            "school": f"""[out:json][timeout:25];
(node["amenity"="school"](around:{r},{lat},{lng});
 way["amenity"="school"](around:{r},{lat},{lng});
 node["amenity"="university"](around:{min(r+1000,5000)},{lat},{lng});
 node["amenity"="college"](around:{min(r+1000,5000)},{lat},{lng}););
out center;""",

            "healthcare": f"""[out:json][timeout:25];
(node["amenity"="hospital"](around:{r},{lat},{lng});
 way["amenity"="hospital"](around:{r},{lat},{lng});
 node["amenity"="clinic"](around:{min(r,2000)},{lat},{lng});
 node["amenity"="pharmacy"](around:{min(r,1000)},{lat},{lng});
 node["healthcare"="centre"](around:{min(r,2000)},{lat},{lng}););
out center;""",

            "lifestyle": f"""[out:json][timeout:25];
(node["amenity"="restaurant"](around:{min(r,1000)},{lat},{lng});
 node["amenity"="cafe"](around:{min(r,1000)},{lat},{lng});
 node["leisure"="fitness_centre"](around:{min(r,1000)},{lat},{lng});
 node["leisure"="park"](around:{min(r,500)},{lat},{lng});
 way["leisure"="park"](around:{min(r,500)},{lat},{lng});
 node["shop"="supermarket"](around:{min(r,1000)},{lat},{lng});
 node["shop"="mall"](around:{min(r,2000)},{lat},{lng}););
out center;""",

            "premium": f"""[out:json][timeout:25];
(way["leisure"="golf_course"](around:{min(r,3000)},{lat},{lng});
 way["waterway"~"river|stream"](around:{min(r,500)},{lat},{lng});
 node["waterway"~"river|stream"](around:{min(r,500)},{lat},{lng});
 way["natural"="water"](around:{min(r,1000)},{lat},{lng});
 node["railway"="station"](around:{min(r,800)},{lat},{lng});
 node["railway"="tram_stop"](around:{min(r,800)},{lat},{lng});
 node["public_transport"="station"](around:{min(r,800)},{lat},{lng});
 way["leisure"="park"]["name"](around:{min(r,1000)},{lat},{lng}););
out center tags;""",
        }

        elements = self._overpass_query(queries.get(amenity_type, ""))
        locations = self._parse_elements(elements, lat, lng)

        return {
            "amenity_type": amenity_type,
            "count": len(locations),
            "locations": locations[:20],
        }

    def calculate_proximity_score(
        self,
        lat: float, lng: float,
        locations: list[dict],
        dimension: str,
    ) -> dict:
        score = 0
        details: list[str] = []

        if dimension == "school":
            for loc in locations:
                d = loc.get("distance_km", 999)
                pts = 5 if d <= 0.5 else 3 if d <= 1.0 else 1 if d <= 2.0 else 0
                score += pts
                if pts:
                    details.append(f"{loc.get('name','School')} ({d:.1f}km) +{pts}pts")
            score = min(20, score)

        elif dimension == "healthcare":
            hospital_added = False
            clinic_pts = pharmacy_pts = 0
            for loc in locations:
                d = loc.get("distance_km", 999)
                t = loc.get("type", "")
                n = loc.get("name", "")
                if "hospital" in t and d <= 5.0 and not hospital_added:
                    score += 8; hospital_added = True
                    details.append(f"Hospital: {n} ({d:.1f}km) +8pts")
                elif ("clinic" in t or "centre" in t) and d <= 2.0 and clinic_pts < 6:
                    score += 3; clinic_pts += 3
                    details.append(f"Clinic: {n} ({d:.1f}km) +3pts")
                elif "pharmacy" in t and d <= 1.0 and pharmacy_pts < 4:
                    score += 2; pharmacy_pts += 2
                    details.append(f"Pharmacy: {n} ({d:.1f}km) +2pts")
            score = min(15, score)

        elif dimension == "lifestyle":
            food_pts = gym_pts = park_pts = market_pts = shop_pts = 0
            for loc in locations:
                d = loc.get("distance_km", 999)
                t = loc.get("type", "")
                n = loc.get("name", "")
                if t in ("restaurant", "cafe") and d <= 1.0 and food_pts < 5:
                    score += 1; food_pts += 1
                elif "fitness" in t and d <= 1.0 and gym_pts < 4:
                    score += 2; gym_pts += 2
                    details.append(f"Gym: {n} ({d:.1f}km) +2pts")
                elif "park" in t and d <= 0.5 and park_pts < 6:
                    score += 3; park_pts += 3
                    details.append(f"Park: {n} ({d:.1f}km) +3pts")
                elif "supermarket" in t and d <= 1.0 and market_pts < 3:
                    score += 3; market_pts += 3
                    details.append(f"Supermarket: {n} ({d:.1f}km) +3pts")
                elif "mall" in t and d <= 2.0 and shop_pts < 2:
                    score += 2; shop_pts += 2
                    details.append(f"Shopping: {n} ({d:.1f}km) +2pts")
            if food_pts:
                details.insert(0, f"{food_pts} restaurants/cafes within 1km +{food_pts}pts")
            score = min(20, score)

        elif dimension == "premium":
            water_added = golf_added = park_added = transit_added = False
            for loc in locations:
                d = loc.get("distance_km", 999)
                t = loc.get("type", "")
                n = loc.get("name", "")
                if not water_added and ("river" in t or "stream" in t or ("water" in t and d <= 0.5)):
                    score += 8; water_added = True
                    details.append(f"Waterfront: {n or 'River'} ({d:.1f}km) +8pts")
                elif not golf_added and "golf" in t and d <= 3.0:
                    score += 5; golf_added = True
                    details.append(f"Golf course: {n} ({d:.1f}km) +5pts")
                elif not park_added and "park" in t and d <= 1.0:
                    score += 4; park_added = True
                    details.append(f"Large park: {n} ({d:.1f}km) +4pts")
                elif not transit_added and ("station" in t or "tram" in t or "public_transport" in t) and d <= 0.8:
                    score += 3; transit_added = True
                    details.append(f"Transit: {n} ({d:.1f}km) +3pts")
            score = min(20, score)

        return {"score": score, "max": {"school": 20, "healthcare": 15, "lifestyle": 20, "premium": 20}[dimension], "details": details}

    def identify_value_drivers(self, lat: float, lng: float) -> dict:
        elements = self._overpass_query(f"""[out:json][timeout:30];
(way["waterway"~"river|stream"]["name"](around:800,{lat},{lng});
 way["natural"="water"]["name"](around:1000,{lat},{lng});
 way["leisure"="golf_course"]["name"](around:3000,{lat},{lng});
 node["railway"="station"]["name"](around:800,{lat},{lng});
 node["railway"="tram_stop"]["name"](around:800,{lat},{lng});
 way["leisure"="park"]["name"](around:1500,{lat},{lng});
 node["amenity"="university"]["name"](around:3000,{lat},{lng}););
out center tags;""")

        drivers = []
        for el in elements:
            tags = el.get("tags", {})
            el_lat = el.get("lat") or (el.get("center") or {}).get("lat")
            el_lng = el.get("lon") or (el.get("center") or {}).get("lon")
            if not (el_lat and el_lng):
                continue
            name = tags.get("name", "")
            feat = (
                tags.get("waterway") or tags.get("leisure") or
                tags.get("railway") or tags.get("natural") or
                tags.get("amenity") or "feature"
            )
            dist = haversine_km(lat, lng, el_lat, el_lng)
            if name:
                drivers.append({"name": name, "type": feat, "distance_km": round(dist, 2)})

        drivers.sort(key=lambda x: x["distance_km"])
        return {"value_drivers": drivers[:15]}

    # ── Tool dispatcher ────────────────────────────────────────────────────────

    def _execute_tool(self, name: str, inputs: dict) -> dict:
        dispatch = {
            "get_house_prices":         lambda i: self.get_house_prices(i["neighborhood"]),
            "get_price_trend":          lambda i: self.get_price_trend(i["neighborhood"]),
            "get_nearby_amenities":     lambda i: self.get_nearby_amenities(
                i["lat"], i["lng"], i["radius_km"], i["amenity_type"]
            ),
            "calculate_proximity_score": lambda i: self.calculate_proximity_score(
                i["lat"], i["lng"], i["locations"], i["dimension"]
            ),
            "identify_value_drivers":   lambda i: self.identify_value_drivers(i["lat"], i["lng"]),
        }
        fn = dispatch.get(name)
        return fn(inputs) if fn else {"error": f"Unknown tool: {name}"}

    # ── Agent loop ─────────────────────────────────────────────────────────────

    def run(self, neighborhood: str, lat: float, lng: float) -> dict:
        system_prompt = (
            "You are PropIQ's expert real estate investment analyst for Denver, CO. "
            "You use tools to gather hard data and make specific, evidence-based investment "
            "recommendations. Always call all required tools before giving your final answer. "
            "Be concise, cite actual numbers, and think like a professional real estate investor."
        )

        user_prompt = f"""Evaluate the real estate investment potential of "{neighborhood}"
at coordinates ({lat}, {lng}) in the Denver, CO metro area.

Call these tools in this order:
1. get_price_trend("{neighborhood}") — get ROI and market velocity
2. get_nearby_amenities(lat={lat}, lng={lng}, radius_km=2.0, amenity_type="school")
3. get_nearby_amenities(lat={lat}, lng={lng}, radius_km=5.0, amenity_type="healthcare")
4. get_nearby_amenities(lat={lat}, lng={lng}, radius_km=1.5, amenity_type="lifestyle")
5. identify_value_drivers(lat={lat}, lng={lng})
6. calculate_proximity_score for each dimension using the location data you gathered

After all tool calls, output ONLY this JSON (no markdown fences):
{{
  "dimensions": {{
    "price_momentum": {{"score": <0-25>, "trend": "<+X.X% YoY>", "reasoning": "<2-3 sentences>"}},
    "school_proximity": {{"score": <0-20>, "count": <n>, "nearest_km": <float>, "reasoning": "<2-3 sentences>"}},
    "healthcare": {{"score": <0-15>, "count": <n>, "reasoning": "<2-3 sentences>"}},
    "lifestyle": {{"score": <0-20>, "count": <n>, "reasoning": "<2-3 sentences>"}},
    "premium_factors": {{"score": <0-20>, "reasoning": "<2-3 sentences citing specific named features>"}}
  }},
  "value_drivers_identified": ["<specific driver with distance>", ...],
  "risk_factors": ["<specific risk>", ...],
  "agent_summary": "<2-3 paragraph professional investment analysis with specific data>"
}}"""

        messages = [{"role": "user", "content": user_prompt}]

        for _ in range(12):  # max iterations
            response = self.client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4096,
                tools=self.tools,
                messages=messages,
                system=system_prompt,
            )

            messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                break

            if response.stop_reason == "tool_use":
                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        result = self._execute_tool(block.name, block.input)
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps(result),
                        })
                messages.append({"role": "user", "content": tool_results})
            else:
                break

        # Extract the JSON evaluation from the final response
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text = block.text
                break

        try:
            start = final_text.find("{")
            end = final_text.rfind("}") + 1
            if start >= 0 and end > start:
                ev = json.loads(final_text[start:end])
            else:
                ev = {}
        except (json.JSONDecodeError, ValueError):
            ev = {}

        dims = ev.get("dimensions", {})
        total = sum(d.get("score", 0) for d in dims.values())

        verdict = (
            "STRONG BUY" if total >= 80 else
            "BUY"        if total >= 65 else
            "HOLD"       if total >= 45 else
            "AVOID"
        )

        return {
            "neighborhood": neighborhood,
            "total_score": total,
            "max_score": 100,
            "verdict": verdict,
            "dimensions": {
                "price_momentum":  {**dims.get("price_momentum",  {}), "max": 25},
                "school_proximity": {**dims.get("school_proximity", {}), "max": 20},
                "healthcare":      {**dims.get("healthcare",       {}), "max": 15},
                "lifestyle":       {**dims.get("lifestyle",        {}), "max": 20},
                "premium_factors": {**dims.get("premium_factors",  {}), "max": 20},
            },
            "value_drivers_identified": ev.get("value_drivers_identified", []),
            "risk_factors":             ev.get("risk_factors", []),
            "agent_summary":            ev.get("agent_summary", ""),
        }


# ── Public entry-point ─────────────────────────────────────────────────────────

def evaluate_neighborhood(neighborhood: str, lat: float, lng: float) -> dict:
    """Run the evaluator agent and return a structured evaluation dict."""
    return NeighborhoodEvaluatorAgent().run(neighborhood, lat, lng)


if __name__ == "__main__":
    # Quick test: python neighborhood_evaluator.py "Capitol Hill" 39.7312 -104.9758
    args = sys.argv[1:]
    name = args[0] if len(args) > 0 else "Cherry Creek"
    _lat = float(args[1]) if len(args) > 1 else 39.7157
    _lng = float(args[2]) if len(args) > 2 else -104.9553
    result = evaluate_neighborhood(name, _lat, _lng)
    print(json.dumps(result, indent=2))
