const BASE = "http://localhost:8000";

export interface Property {
  id: number;
  name: string;
  metro: string | null;
  price: number;
  expected_return: number;
  roi_pct: number;
  days_on_market: number | null;
  lat: number | null;
  lng: number | null;
  h3_7: string | null;
  h3_9: string | null;
  h3_index: string | null;   // alias for h3_7 (backward compat)
}

export interface Amenity {
  id: number;
  osm_id: number | null;
  type: "gas_station" | "school" | "hospital";
  name: string | null;
  lat: number;
  lng: number;
  h3_7: string | null;
  h3_9: string | null;
}

export interface DemographicsData {
  total_pop: number | null;
  pop_under_18: number | null;
  pct_under_18: number | null;
  median_income: number | null;
  tract_count: number;
}

export interface DemographicsResponse {
  neighborhood: string;
  data: DemographicsData | null;
  note?: string;
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export interface PropertiesResponse {
  total: number;
  properties: Property[];
}

export async function fetchProperties(limit = 10000): Promise<PropertiesResponse> {
  const res = await fetch(`${BASE}/api/v1/properties?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch properties");
  return res.json();
}

export async function fetchMetros(): Promise<string[]> {
  const res = await fetch(`${BASE}/api/v1/metros`);
  if (!res.ok) throw new Error("Failed to fetch metros");
  const data = await res.json();
  return data.metros as string[];
}

export async function loadData(source: "neighborhoods" | "cities" = "neighborhoods") {
  const res = await fetch(`${BASE}/api/v1/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  if (!res.ok) throw new Error("Failed to load data");
  return res.json();
}

export async function askAdvisor(question: string, includeContext = true): Promise<string> {
  const res = await fetch(`${BASE}/api/v1/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, include_context: includeContext }),
  });
  if (!res.ok) throw new Error("AI advisor failed");
  const data = await res.json();
  return data.answer as string;
}

// ── Amenity API ────────────────────────────────────────────────────────────────

export async function fetchAmenities(
  lat: number,
  lng: number,
  type: string,
  radiusKm = 2.0,
): Promise<Amenity[]> {
  const res = await fetch(
    `${BASE}/api/v1/amenities?lat=${lat}&lng=${lng}&type=${type}&radius_km=${radiusKm}`,
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.amenities as Amenity[];
}

export async function fetchAmenitiesInBounds(
  swLat: number, swLng: number,
  neLat: number, neLng: number,
  types = "gas_station,school,hospital",
): Promise<Amenity[]> {
  const url =
    `${BASE}/api/v1/amenities/all` +
    `?sw_lat=${swLat}&sw_lng=${swLng}&ne_lat=${neLat}&ne_lng=${neLng}&types=${encodeURIComponent(types)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.amenities as Amenity[];
  } catch {
    return [];
  }
}

// ── Demographics API ───────────────────────────────────────────────────────────

export async function fetchDemographics(
  neighborhood: string,
): Promise<DemographicsResponse | null> {
  try {
    const res = await fetch(
      `${BASE}/api/v1/demographics?neighborhood=${encodeURIComponent(neighborhood)}`,
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchDemographicsBatch(): Promise<Record<string, DemographicsData>> {
  try {
    const res = await fetch(`${BASE}/api/v1/demographics/batch`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.demographics as Record<string, DemographicsData>;
  } catch {
    return {};
  }
}

// ── H3 neighbors API ──────────────────────────────────────────────────────────

export async function fetchH3Neighbors(
  h3Index: string,
  rings = 2,
): Promise<{ cells: string[]; neighborhoods: Property[] }> {
  try {
    const res = await fetch(
      `${BASE}/api/v1/h3/neighbors?h3_index=${h3Index}&rings=${rings}`,
    );
    if (!res.ok) return { cells: [], neighborhoods: [] };
    return res.json();
  } catch {
    return { cells: [], neighborhoods: [] };
  }
}

// ── Address lookup via Nominatim + H3 ─────────────────────────────────────────

export interface GeoPoint {
  lat: number;
  lng: number;
  displayName: string;
  city: string | null;
}

export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const url =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "PropIQ/1.0 (property investment research tool)" },
  });
  if (!res.ok) throw new Error("Geocoding service unavailable");
  const data = await res.json();
  if (!data.length) return null;
  const r = data[0];
  const a = r.address ?? {};
  return {
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    displayName: r.display_name,
    city: a.city ?? a.town ?? a.village ?? null,
  };
}

export interface H3Match {
  property: Property;
  exact: boolean;
  gridDistance: number;
}

export async function findNearestByH3(
  lat: number,
  lng: number,
  properties: Property[],
): Promise<H3Match | null> {
  const { latLngToCell, gridDistance, cellToLatLng } = await import("h3-js");

  const H3_RES  = 7;
  const addrCell = latLngToCell(lat, lng, H3_RES);
  const indexed  = properties.filter((p) => p.h3_index || p.h3_7);
  if (!indexed.length) return null;

  let best: Property | null = null;
  let bestDist = Infinity;

  for (const p of indexed) {
    const cell = p.h3_7 || p.h3_index;
    let dist: number;
    try {
      dist = gridDistance(addrCell, cell!);
      if (dist < 0) throw new Error("incomparable");
    } catch {
      const [pLat, pLng] = cellToLatLng(cell!);
      const dlat = lat - pLat, dlng = lng - pLng;
      dist = (Math.sqrt(dlat * dlat + dlng * dlng) * 111) / 1.22;
    }
    if (dist < bestDist) { bestDist = dist; best = p; }
  }

  if (!best) return null;
  return { property: best, exact: bestDist === 0, gridDistance: Math.round(bestDist) };
}

// ── Badges & scoring ──────────────────────────────────────────────────────────

export type Badge = "HOT" | "WARM" | "COOL";
export type Verdict = "BUY" | "HOLD" | "AVOID";

export const BADGE_INFO: Record<Badge, { label: string; subtitle: string }> = {
  HOT:  { label: "🔥 High Demand",    subtitle: "Prices rising fast, homes sell quickly"   },
  WARM: { label: "✨ Moderate Market", subtitle: "Steady growth, balanced buyer demand"     },
  COOL: { label: "❄️ Slow Market",    subtitle: "Low demand, prices growing slowly"         },
};

export function badge(roi: number): Badge {
  if (roi >= 8) return "HOT";
  if (roi >= 4) return "WARM";
  return "COOL";
}

export function verdict(roi: number): Verdict {
  if (roi >= 8) return "BUY";
  if (roi >= 4) return "HOLD";
  return "AVOID";
}

export function investmentScore(roi: number): number {
  return Math.min(100, Math.round(roi * 10));
}

export const PERIODS = [
  { months: 3,  short: "3 mo", label: "3 months" },
  { months: 6,  short: "6 mo", label: "6 months" },
  { months: 12, short: "1 yr", label: "1 year"   },
  { months: 24, short: "2 yr", label: "2 years"  },
  { months: 60, short: "5 yr", label: "5 years"  },
] as const;

export type PeriodMonths = (typeof PERIODS)[number]["months"];

export function earnForPeriod(p: Property, months: number): number {
  return Math.round(p.expected_return * (months / 12));
}

export function projections(p: Property, totalMonths = 6): { month: number; value: number }[] {
  let checkpoints: number[];
  if (totalMonths <= 6) {
    checkpoints = Array.from({ length: totalMonths }, (_, i) => i + 1);
  } else if (totalMonths <= 12) {
    checkpoints = [2, 4, 6, 8, 10, 12].filter((m) => m <= totalMonths);
  } else if (totalMonths <= 24) {
    checkpoints = [3, 6, 9, 12, 18, 24].filter((m) => m <= totalMonths);
  } else {
    const years = totalMonths / 12;
    checkpoints = Array.from({ length: years }, (_, i) => (i + 1) * 12);
  }
  return checkpoints.map((month) => ({ month, value: earnForPeriod(p, month) }));
}
