import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

// Allow up to 60s for Overpass + Claude calls (requires Vercel Pro)
export const maxDuration = 60;

const sql = neon(process.env.DATABASE_URL!);
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverpassEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface LocationResult {
  lat: number;
  lng: number;
  name: string;
  type: string;
  distance_km: number;
}

export interface EvaluationMarker extends LocationResult {
  markerType: "school" | "hospital" | "park" | "transit" | "waterfront" | "lifestyle" | "premium";
}

export interface DimensionResult {
  score: number;
  max: number;
  reasoning: string;
  locations?: LocationResult[];
  trend?: string;
  roi_pct?: number;
  days_on_market?: number | null;
  count?: number;
  nearest_km?: number;
}

export interface NeighborhoodEvaluation {
  neighborhood: string;
  total_score: number;
  max_score: number;
  verdict: "STRONG BUY" | "BUY" | "HOLD" | "AVOID";
  dimensions: {
    price_momentum: DimensionResult;
    school_proximity: DimensionResult;
    healthcare: DimensionResult;
    lifestyle: DimensionResult;
    premium_factors: DimensionResult;
  };
  value_drivers_identified: string[];
  risk_factors: string[];
  agent_summary: string;
  evaluation_markers: EvaluationMarker[];
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Overpass helpers ──────────────────────────────────────────────────────────

async function queryOverpass(query: string): Promise<OverpassEl[]> {
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "PropIQ/1.0 neighborhood evaluator",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(27000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.elements as OverpassEl[]) || [];
  } catch {
    return [];
  }
}

function parseLocations(
  elements: OverpassEl[],
  originLat: number,
  originLng: number,
): LocationResult[] {
  return elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) return null;
      const t = el.tags ?? {};
      const name =
        t.name ||
        t.amenity ||
        t.leisure ||
        t.shop ||
        t.waterway ||
        t.railway ||
        el.type;
      const type =
        t.amenity ||
        t.leisure ||
        t.shop ||
        t.waterway ||
        t.railway ||
        t.public_transport ||
        t.natural ||
        "unknown";
      return {
        lat,
        lng,
        name,
        type,
        distance_km: Math.round(haversineKm(originLat, originLng, lat, lng) * 100) / 100,
      } as LocationResult;
    })
    .filter(Boolean)
    .sort((a, b) => a!.distance_km - b!.distance_km) as LocationResult[];
}

// ── Single combined Overpass query (avoids rate limiting) ─────────────────────

function combinedQuery(lat: number, lng: number) {
  return `[out:json][timeout:55];
(
node["amenity"="school"](around:2000,${lat},${lng});
way["amenity"="school"](around:2000,${lat},${lng});
node["amenity"="university"](around:3000,${lat},${lng});
node["amenity"="college"](around:3000,${lat},${lng});
node["amenity"="hospital"](around:5000,${lat},${lng});
way["amenity"="hospital"](around:5000,${lat},${lng});
node["amenity"="clinic"](around:2000,${lat},${lng});
node["amenity"="pharmacy"](around:1000,${lat},${lng});
node["healthcare"="centre"](around:2000,${lat},${lng});
node["amenity"="restaurant"](around:1000,${lat},${lng});
node["amenity"="cafe"](around:1000,${lat},${lng});
node["leisure"="fitness_centre"](around:1000,${lat},${lng});
node["leisure"="park"](around:500,${lat},${lng});
way["leisure"="park"](around:500,${lat},${lng});
node["shop"="supermarket"](around:1000,${lat},${lng});
node["shop"="mall"](around:2000,${lat},${lng});
way["leisure"="golf_course"](around:3000,${lat},${lng});
way["waterway"~"river|stream"](around:500,${lat},${lng});
node["waterway"~"river|stream"](around:500,${lat},${lng});
way["natural"="water"](around:1000,${lat},${lng});
node["railway"="station"](around:800,${lat},${lng});
node["railway"="tram_stop"](around:800,${lat},${lng});
node["public_transport"="station"](around:800,${lat},${lng});
way["leisure"="park"]["name"](around:1000,${lat},${lng});
);
out center tags;`;
}

function partitionElements(
  elements: OverpassEl[],
  lat: number,
  lng: number,
): {
  schools: LocationResult[];
  healthcare: LocationResult[];
  lifestyle: LocationResult[];
  premium: LocationResult[];
} {
  const all = parseLocations(elements, lat, lng);

  const SCHOOL_TYPES    = new Set(["school", "university", "college"]);
  const HEALTH_TYPES    = new Set(["hospital", "clinic", "pharmacy", "centre"]);
  const LIFESTYLE_TYPES = new Set(["restaurant", "cafe", "fitness_centre", "park", "supermarket", "mall"]);
  const PREMIUM_TYPES   = new Set(["golf_course", "river", "stream", "water", "station", "tram_stop", "public_transport"]);

  return {
    schools:    all.filter((l) => SCHOOL_TYPES.has(l.type)),
    healthcare: all.filter((l) => HEALTH_TYPES.has(l.type)),
    lifestyle:  all.filter((l) => LIFESTYLE_TYPES.has(l.type)),
    premium:    all.filter((l) => PREMIUM_TYPES.has(l.type) || l.type === "park"),
  };
}

// ── Scoring ────────────────────────────────────────────────────────────────────

function scorePriceMomentum(
  roiPct: number,
  daysOnMarket: number | null,
): { score: number; trend: string } {
  let score =
    roiPct >= 15 ? 25 :
    roiPct >= 12 ? 23 :
    roiPct >= 10 ? 21 :
    roiPct >= 8  ? 19 :
    roiPct >= 6  ? 16 :
    roiPct >= 4  ? 12 :
    roiPct >= 2  ? 8  :
    roiPct > 0   ? 4  : 2;

  if (daysOnMarket !== null) {
    if (daysOnMarket < 20) score = Math.min(25, score + 2);
    else if (daysOnMarket > 60) score = Math.max(0, score - 2);
  }

  const trend =
    roiPct >= 10 ? `+${roiPct.toFixed(1)}% YoY — Strong appreciation` :
    roiPct >= 5  ? `+${roiPct.toFixed(1)}% YoY — Moderate growth`     :
    roiPct >= 0  ? `+${roiPct.toFixed(1)}% YoY — Slow growth`         :
                   `${roiPct.toFixed(1)}% YoY — Declining`;

  return { score, trend };
}

function scoreSchools(locs: LocationResult[]): {
  score: number; count: number; nearest_km: number; found: LocationResult[];
} {
  const schools = locs.filter((l) =>
    ["school", "university", "college"].includes(l.type),
  );
  let score = 0;
  for (const s of schools) {
    score += s.distance_km <= 0.5 ? 5 : s.distance_km <= 1.0 ? 3 : s.distance_km <= 2.0 ? 1 : 0;
  }
  return {
    score: Math.min(20, score),
    count: schools.length,
    nearest_km: schools[0]?.distance_km ?? 99,
    found: schools.slice(0, 6),
  };
}

function scoreHealthcare(locs: LocationResult[]): {
  score: number; count: number; found: LocationResult[];
} {
  let score = 0;
  let hasHosp = false, clinicPts = 0, pharmPts = 0;
  for (const l of locs) {
    if (l.type === "hospital" && l.distance_km <= 5.0 && !hasHosp) {
      score += 8; hasHosp = true;
    } else if (
      (l.type === "clinic" || l.type === "centre") &&
      l.distance_km <= 2.0 && clinicPts < 6
    ) {
      score += 3; clinicPts += 3;
    } else if (l.type === "pharmacy" && l.distance_km <= 1.0 && pharmPts < 4) {
      score += 2; pharmPts += 2;
    }
  }
  return { score: Math.min(15, score), count: locs.length, found: locs.slice(0, 5) };
}

function scoreLifestyle(locs: LocationResult[]): {
  score: number; count: number; found: LocationResult[];
} {
  let score = 0;
  let food = 0, gym = 0, park = 0, market = 0, shop = 0;
  for (const l of locs) {
    if ((l.type === "restaurant" || l.type === "cafe") && l.distance_km <= 1.0 && food < 5) { score++; food++; }
    else if (l.type === "fitness_centre" && l.distance_km <= 1.0 && gym < 4) { score += 2; gym += 2; }
    else if (l.type === "park" && l.distance_km <= 0.5 && park < 6) { score += 3; park += 3; }
    else if (l.type === "supermarket" && l.distance_km <= 1.0 && market < 3) { score += 3; market += 3; }
    else if (l.type === "mall" && l.distance_km <= 2.0 && shop < 2) { score += 2; shop += 2; }
  }
  return { score: Math.min(20, score), count: locs.length, found: locs.slice(0, 6) };
}

function scorePremium(locs: LocationResult[]): {
  score: number; found: LocationResult[];
} {
  let score = 0;
  const found: LocationResult[] = [];

  const river = locs.find(
    (l) => (l.type === "river" || l.type === "stream" || l.type === "water") && l.distance_km <= 0.5,
  );
  if (river) { score += 8; found.push(river); }

  const golf = locs.find((l) => l.type === "golf_course" && l.distance_km <= 3.0);
  if (golf) { score += 5; found.push(golf); }

  const park = locs.find((l) => l.type === "park" && l.distance_km <= 1.0);
  if (park) { score += 4; found.push(park); }

  const transit = locs.find(
    (l) =>
      (l.type === "station" || l.type === "tram_stop" || l.type === "public_transport") &&
      l.distance_km <= 0.8,
  );
  if (transit) { score += 3; found.push(transit); }

  return { score: Math.min(20, score), found };
}

// ── Claude reasoning ──────────────────────────────────────────────────────────

async function getClaudeReasoning(
  neighborhood: string,
  scores: Record<string, any>,
  locations: {
    schools: LocationResult[];
    healthcare: LocationResult[];
    lifestyle: LocationResult[];
    premium: LocationResult[];
  },
): Promise<{
  dimension_reasoning: Record<string, string>;
  value_drivers: string[];
  risk_factors: string[];
  agent_summary: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Fallback when no API key
  const fallback = () => ({
    dimension_reasoning: {
      price_momentum: `${neighborhood} shows a ${scores.price_momentum.roi_pct}% annual ROI, scoring ${scores.price_momentum.score}/25. ${scores.price_momentum.days_on_market ? `Homes sell in ${scores.price_momentum.days_on_market} days on average.` : ""}`,
      school_proximity: `${scores.school_proximity.count} schools within 2km, nearest at ${scores.school_proximity.nearest_km}km. Score: ${scores.school_proximity.score}/20.`,
      healthcare: `${scores.healthcare.count} healthcare facilities in the search area. Score: ${scores.healthcare.score}/15.`,
      lifestyle: `${scores.lifestyle.count} lifestyle venues within range contributing to neighborhood desirability. Score: ${scores.lifestyle.score}/20.`,
      premium_factors: `Premium location features scored ${scores.premium_factors.score}/20 based on waterfront, parks, golf, and transit access.`,
    },
    value_drivers: locations.premium.slice(0, 3).map((l) => `${l.name} (${l.distance_km}km)`),
    risk_factors: ["Verify current market conditions", "Check local development plans"],
    agent_summary: `${neighborhood} scores ${scores.total_score}/100 — ${scores.verdict}. ${scores.price_momentum.roi_pct >= 8 ? "Strong price appreciation" : "Moderate growth"} combined with ${scores.school_proximity.score >= 12 ? "good school access" : "available amenities"} shapes this recommendation.`,
  });

  if (!apiKey) return fallback();

  try {
    const prompt = `You are a real estate investment analyst for Denver, CO. Write specific, data-driven insights for "${neighborhood}".

SCORES (out of max):
- Price Momentum: ${scores.price_momentum.score}/25 — ROI ${scores.price_momentum.roi_pct}%, ${scores.price_momentum.days_on_market ?? "N/A"} DOM
- Schools: ${scores.school_proximity.score}/20 — ${scores.school_proximity.count} schools, nearest ${scores.school_proximity.nearest_km}km
- Healthcare: ${scores.healthcare.score}/15 — ${scores.healthcare.count} facilities
- Lifestyle: ${scores.lifestyle.score}/20 — ${scores.lifestyle.count} venues
- Premium Factors: ${scores.premium_factors.score}/20
- TOTAL: ${scores.total_score}/100 — ${scores.verdict}

TOP LOCATIONS:
Schools: ${JSON.stringify(locations.schools.slice(0, 3))}
Healthcare: ${JSON.stringify(locations.healthcare.slice(0, 3))}
Lifestyle: ${JSON.stringify(locations.lifestyle.slice(0, 3))}
Premium: ${JSON.stringify(locations.premium.slice(0, 5))}

Return ONLY valid JSON (no markdown):
{
  "dimension_reasoning": {
    "price_momentum": "2-3 sentences citing ROI data and market velocity",
    "school_proximity": "2-3 sentences citing school names and distances",
    "healthcare": "2-3 sentences about healthcare access",
    "lifestyle": "2-3 sentences about lifestyle venues",
    "premium_factors": "2-3 sentences naming specific waterways, parks, transit"
  },
  "value_drivers": ["named driver with distance", "named driver with distance"],
  "risk_factors": ["specific risk 1", "specific risk 2"],
  "agent_summary": "2-3 paragraph professional investment summary citing specific data points"
}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return fallback();
    const data = await res.json();
    const text: string = data.content?.[0]?.text ?? "";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}") + 1;
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end));
    }
  } catch {
    // fall through
  }

  return fallback();
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const neighborhood = searchParams.get("neighborhood")?.trim() ?? "";
  const lat = parseFloat(searchParams.get("lat") ?? "0");
  const lng = parseFloat(searchParams.get("lng") ?? "0");

  if (!neighborhood || !lat || !lng) {
    return NextResponse.json(
      { error: "Required query params: neighborhood, lat, lng" },
      { status: 400 },
    );
  }

  // 1. Price data from Neon
  let roiPct = 5;
  let daysOnMarket: number | null = null;
  let price = 0;
  try {
    const rows = await sql`
      SELECT price, expected_return, days_on_market
      FROM   neighborhoods
      WHERE  LOWER(name) LIKE ${`%${neighborhood.toLowerCase()}%`}
      LIMIT  1
    `;
    if (rows.length > 0) {
      const r = rows[0];
      price = Number(r.price) || 0;
      const exp = Number(r.expected_return) || 0;
      roiPct = price > 0 ? Math.round((exp / price) * 10000) / 100 : 0;
      daysOnMarket = r.days_on_market != null ? Number(r.days_on_market) : null;
    }
  } catch {
    // use defaults
  }

  // 2. Single combined Overpass query (avoids rate limiting)
  const allElements = await queryOverpass(combinedQuery(lat, lng));
  const { schools, healthcare, lifestyle, premium } = partitionElements(allElements, lat, lng);

  // 3. Score each dimension
  const { score: pmScore, trend }  = scorePriceMomentum(roiPct, daysOnMarket);
  const schoolResult    = scoreSchools(schools);
  const healthResult    = scoreHealthcare(healthcare);
  const lifestyleResult = scoreLifestyle(lifestyle);
  const premiumResult   = scorePremium(premium);

  const totalScore =
    pmScore +
    schoolResult.score +
    healthResult.score +
    lifestyleResult.score +
    premiumResult.score;

  const verdict: NeighborhoodEvaluation["verdict"] =
    totalScore >= 80 ? "STRONG BUY" :
    totalScore >= 65 ? "BUY"        :
    totalScore >= 45 ? "HOLD"       :
    "AVOID";

  const scoresPayload = {
    price_momentum:  { score: pmScore, roi_pct: roiPct, days_on_market: daysOnMarket, trend },
    school_proximity: { score: schoolResult.score, count: schoolResult.count, nearest_km: schoolResult.nearest_km },
    healthcare:      { score: healthResult.score, count: healthResult.count },
    lifestyle:       { score: lifestyleResult.score, count: lifestyleResult.count },
    premium_factors: { score: premiumResult.score },
    total_score: totalScore,
    verdict,
  };

  // 4. Claude for reasoning
  const reasoning = await getClaudeReasoning(neighborhood, scoresPayload, {
    schools, healthcare, lifestyle, premium,
  });

  // 5. Build map markers
  const evaluationMarkers: EvaluationMarker[] = [
    ...schoolResult.found.slice(0, 8).map((l) => ({
      ...l, markerType: "school" as const,
    })),
    ...healthResult.found.slice(0, 5).map((l) => ({
      ...l, markerType: "hospital" as const,
    })),
    ...lifestyle
      .filter((l) => l.type === "park")
      .slice(0, 4)
      .map((l) => ({ ...l, markerType: "park" as const })),
    ...premiumResult.found.map((l) => {
      const mType =
        l.type === "river" || l.type === "stream" || l.type === "water"
          ? ("waterfront" as const)
          : l.type === "station" || l.type === "tram_stop"
          ? ("transit" as const)
          : ("premium" as const);
      return { ...l, markerType: mType };
    }),
    ...lifestyle
      .filter((l) => l.type === "fitness_centre" || l.type === "supermarket")
      .slice(0, 4)
      .map((l) => ({ ...l, markerType: "lifestyle" as const })),
  ];

  const response: NeighborhoodEvaluation = {
    neighborhood,
    total_score: totalScore,
    max_score: 100,
    verdict,
    dimensions: {
      price_momentum: {
        score: pmScore, max: 25, trend,
        roi_pct: roiPct, days_on_market: daysOnMarket,
        reasoning: reasoning.dimension_reasoning.price_momentum ?? "",
      },
      school_proximity: {
        score: schoolResult.score, max: 20,
        count: schoolResult.count, nearest_km: schoolResult.nearest_km,
        locations: schoolResult.found,
        reasoning: reasoning.dimension_reasoning.school_proximity ?? "",
      },
      healthcare: {
        score: healthResult.score, max: 15,
        count: healthResult.count,
        locations: healthResult.found,
        reasoning: reasoning.dimension_reasoning.healthcare ?? "",
      },
      lifestyle: {
        score: lifestyleResult.score, max: 20,
        count: lifestyleResult.count,
        locations: lifestyleResult.found,
        reasoning: reasoning.dimension_reasoning.lifestyle ?? "",
      },
      premium_factors: {
        score: premiumResult.score, max: 20,
        locations: premiumResult.found,
        reasoning: reasoning.dimension_reasoning.premium_factors ?? "",
      },
    },
    value_drivers_identified: reasoning.value_drivers ?? [],
    risk_factors:             reasoning.risk_factors   ?? [],
    agent_summary:            reasoning.agent_summary  ?? "",
    evaluation_markers: evaluationMarkers,
  };

  return NextResponse.json(response);
}
