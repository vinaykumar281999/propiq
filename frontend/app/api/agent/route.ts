import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// ── Geometry ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
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

interface OverpassEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function queryOverpass(query: string): Promise<OverpassEl[]> {
  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "PropIQ/1.0 agent tool",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.elements as OverpassEl[]) ?? [];
  } catch {
    return [];
  }
}

function parseLocations(elements: OverpassEl[], originLat: number, originLng: number) {
  return elements
    .map((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat == null || lng == null) return null;
      const t = el.tags ?? {};
      const name = t.name || t.amenity || t.leisure || t.shop || t.waterway || el.type;
      const type = t.amenity || t.leisure || t.shop || t.waterway || t.railway || "unknown";
      return { name, type, lat, lng, distance_km: Math.round(haversineKm(originLat, originLng, lat, lng) * 100) / 100 };
    })
    .filter(Boolean)
    .sort((a, b) => a!.distance_km - b!.distance_km)
    .slice(0, 10);
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function toolGetPriceData(neighborhood: string) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT name, price, roi_pct, days_on_market, expected_return
      FROM properties
      WHERE LOWER(name) LIKE LOWER(${"%" + neighborhood + "%"})
      ORDER BY price DESC
      LIMIT 3
    `;
    if (!rows.length) return { error: `No price data found for "${neighborhood}"` };
    return { results: rows };
  } catch {
    return { error: "Database unavailable" };
  }
}

async function toolGetSchoolsNearby(lat: number, lng: number, radius_km: number) {
  const r = Math.min(radius_km * 1000, 3000);
  const q = `[out:json][timeout:18];
(
node["amenity"="school"](around:${r},${lat},${lng});
way["amenity"="school"](around:${r},${lat},${lng});
node["amenity"="university"](around:${r},${lat},${lng});
node["amenity"="college"](around:${r},${lat},${lng});
);
out center tags;`;
  const els = await queryOverpass(q);
  const locations = parseLocations(els, lat, lng);
  return { count: locations.length, schools: locations };
}

async function toolGetHospitalsNearby(lat: number, lng: number, radius_km: number) {
  const r = Math.min(radius_km * 1000, 5000);
  const q = `[out:json][timeout:18];
(
node["amenity"="hospital"](around:${r},${lat},${lng});
way["amenity"="hospital"](around:${r},${lat},${lng});
node["amenity"="clinic"](around:${r},${lat},${lng});
node["amenity"="pharmacy"](around:${r},${lat},${lng});
node["healthcare"="centre"](around:${r},${lat},${lng});
);
out center tags;`;
  const els = await queryOverpass(q);
  const locations = parseLocations(els, lat, lng);
  return { count: locations.length, facilities: locations };
}

async function toolGetLifestyleAmenities(lat: number, lng: number, radius_km: number) {
  const r = Math.min(radius_km * 1000, 1500);
  const q = `[out:json][timeout:18];
(
node["amenity"="restaurant"](around:${r},${lat},${lng});
node["amenity"="cafe"](around:${r},${lat},${lng});
node["amenity"="bar"](around:${r},${lat},${lng});
node["leisure"="fitness_centre"](around:${r},${lat},${lng});
node["leisure"="park"](around:${r},${lat},${lng});
way["leisure"="park"](around:${r},${lat},${lng});
node["shop"="supermarket"](around:${r},${lat},${lng});
);
out center tags;`;
  const els = await queryOverpass(q);
  const locations = parseLocations(els, lat, lng);
  return { count: locations.length, amenities: locations };
}

async function toolGetPremiumFactors(lat: number, lng: number, radius_km: number) {
  const r = Math.min(radius_km * 1000, 3000);
  const q = `[out:json][timeout:18];
(
way["leisure"="golf_course"](around:${r},${lat},${lng});
way["waterway"~"river|stream"](around:${r},${lat},${lng});
way["natural"="water"](around:${r},${lat},${lng});
node["railway"="station"](around:${r},${lat},${lng});
node["public_transport"="station"](around:${r},${lat},${lng});
node["railway"="tram_stop"](around:${r},${lat},${lng});
way["leisure"="park"]["name"](around:${r},${lat},${lng});
);
out center tags;`;
  const els = await queryOverpass(q);
  const locations = parseLocations(els, lat, lng);
  return { count: locations.length, factors: locations };
}

function toolCalculateMortgage(
  price: number,
  down_pct: number,
  rate_pct: number,
  term_years: number,
  monthly_rent: number,
) {
  const principal = price * (1 - down_pct / 100);
  const mr = rate_pct / 100 / 12;
  const n = term_years * 12;
  const monthly_payment = principal * (mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
  const cash_flow = monthly_rent - monthly_payment;
  return {
    monthly_payment: Math.round(monthly_payment),
    down_payment: Math.round(price * down_pct / 100),
    loan_amount: Math.round(principal),
    cash_flow_monthly: Math.round(cash_flow),
    cash_flow_annual: Math.round(cash_flow * 12),
    break_even_rent: Math.round(monthly_payment),
  };
}

async function toolCompareNeighborhoods(neighborhood_a: string, neighborhood_b: string) {
  try {
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      SELECT name, price, roi_pct, days_on_market
      FROM properties
      WHERE LOWER(name) LIKE LOWER(${"%" + neighborhood_a + "%"})
         OR LOWER(name) LIKE LOWER(${"%" + neighborhood_b + "%"})
      LIMIT 4
    `;
    if (!rows.length) return { error: "No data found for either neighborhood" };
    return { comparison: rows };
  } catch {
    return { error: "Database unavailable" };
  }
}

// ── Ollama types ──────────────────────────────────────────────────────────────

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
}

interface OllamaApiResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  };
  done: boolean;
  done_reason?: string;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_price_data",
    description: "Get current listing price, ROI percentage, and days on market for a neighborhood from the database.",
    input_schema: {
      type: "object",
      properties: {
        neighborhood: { type: "string", description: "Name of the Denver neighborhood" },
      },
      required: ["neighborhood"],
    },
  },
  {
    name: "get_schools_nearby",
    description: "Find schools, universities, and colleges near a lat/lng point using OpenStreetMap data.",
    input_schema: {
      type: "object",
      properties: {
        lat:       { type: "number", description: "Latitude" },
        lng:       { type: "number", description: "Longitude" },
        radius_km: { type: "number", description: "Search radius in kilometers (default 2)" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "get_hospitals_nearby",
    description: "Find hospitals, clinics, and pharmacies near a lat/lng point.",
    input_schema: {
      type: "object",
      properties: {
        lat:       { type: "number" },
        lng:       { type: "number" },
        radius_km: { type: "number", description: "Search radius in kilometers (default 3)" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "get_lifestyle_amenities",
    description: "Find restaurants, cafes, parks, gyms, and grocery stores near a lat/lng point.",
    input_schema: {
      type: "object",
      properties: {
        lat:       { type: "number" },
        lng:       { type: "number" },
        radius_km: { type: "number", description: "Search radius in kilometers (default 1)" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "get_premium_factors",
    description: "Find premium location factors: golf courses, rivers, lakes, parks, and transit stations near a lat/lng point.",
    input_schema: {
      type: "object",
      properties: {
        lat:       { type: "number" },
        lng:       { type: "number" },
        radius_km: { type: "number", description: "Search radius in kilometers (default 2)" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "calculate_mortgage",
    description: "Calculate monthly mortgage payment, down payment, and rental cash flow for a property.",
    input_schema: {
      type: "object",
      properties: {
        price:         { type: "number", description: "Property purchase price in dollars" },
        down_pct:      { type: "number", description: "Down payment percentage (e.g. 20 for 20%)" },
        rate_pct:      { type: "number", description: "Annual interest rate percentage (e.g. 7.0)" },
        term_years:    { type: "number", description: "Loan term in years (e.g. 30)" },
        monthly_rent:  { type: "number", description: "Expected monthly rental income" },
      },
      required: ["price", "down_pct", "rate_pct", "term_years", "monthly_rent"],
    },
  },
  {
    name: "compare_neighborhoods",
    description: "Compare price and ROI data for two different neighborhoods side by side.",
    input_schema: {
      type: "object",
      properties: {
        neighborhood_a: { type: "string", description: "First neighborhood name" },
        neighborhood_b: { type: "string", description: "Second neighborhood name" },
      },
      required: ["neighborhood_a", "neighborhood_b"],
    },
  },
];

// ── Ollama tool schemas (OpenAI-compatible format) ────────────────────────────

const OLLAMA_TOOLS = TOOLS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_price_data":
      return toolGetPriceData(input.neighborhood as string);
    case "get_schools_nearby":
      return toolGetSchoolsNearby(input.lat as number, input.lng as number, (input.radius_km as number) ?? 2);
    case "get_hospitals_nearby":
      return toolGetHospitalsNearby(input.lat as number, input.lng as number, (input.radius_km as number) ?? 3);
    case "get_lifestyle_amenities":
      return toolGetLifestyleAmenities(input.lat as number, input.lng as number, (input.radius_km as number) ?? 1);
    case "get_premium_factors":
      return toolGetPremiumFactors(input.lat as number, input.lng as number, (input.radius_km as number) ?? 2);
    case "calculate_mortgage":
      return toolCalculateMortgage(
        input.price as number,
        input.down_pct as number,
        input.rate_pct as number,
        input.term_years as number,
        input.monthly_rent as number,
      );
    case "compare_neighborhoods":
      return toolCompareNeighborhoods(input.neighborhood_a as string, input.neighborhood_b as string);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(neighborhood: string, lat: number | null, lng: number | null): string {
  return `You are PropIQ, an AI real estate investment advisor specializing in Denver neighborhoods. You have access to live market data and OpenStreetMap tools.

RULES:
- Always call tools to get real data before answering. Never invent prices, ROIs, or distances.
- For any question about price, value, or investment returns → call get_price_data first.
- For questions about families, kids, or schools → call get_schools_nearby.
- For questions about healthcare → call get_hospitals_nearby.
- For mortgage or budget questions → call calculate_mortgage (use the neighborhood price from get_price_data if needed).
- For neighborhood comparisons → call compare_neighborhoods.
- For "what makes it special" or premium features → call get_premium_factors.
- Keep final answers concise: 2–4 sentences. Always cite specific numbers from tool results.
- Be direct and actionable: clearly recommend or caution the investor.
- Format numbers naturally (e.g. "$720K", "13.4% ROI", "0.3km away").

Current context: You are analyzing ${neighborhood}${lat != null ? ` (coordinates: ${lat}, ${lng})` : ""}.`;
}

// ── Agent loops ───────────────────────────────────────────────────────────────

type SimpleMessage = { role: "user" | "assistant"; content: string };

async function claudeAgentLoop(
  message: string,
  history: SimpleMessage[],
  neighborhood: string,
  lat: number | null,
  lng: number | null,
): Promise<{ answer: string; tools_called: string[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content } as Anthropic.MessageParam)),
    { role: "user", content: message },
  ];
  const tools_called: string[] = [];
  let final_answer = "";

  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: buildSystemPrompt(neighborhood, lat, lng),
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "end_turn") {
      final_answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const tool_results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          tools_called.push(block.name);
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          tool_results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
      messages.push({ role: "user", content: tool_results });
    }
  }

  return { answer: final_answer, tools_called };
}

async function ollamaAgentLoop(
  message: string,
  history: SimpleMessage[],
  neighborhood: string,
  lat: number | null,
  lng: number | null,
): Promise<{ answer: string; tools_called: string[] }> {
  const base  = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL    ?? "llama3.2";

  const messages: OllamaMessage[] = [
    { role: "system",    content: buildSystemPrompt(neighborhood, lat, lng) },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user",      content: message },
  ];

  const tools_called: string[] = [];
  let final_answer = "";

  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: OLLAMA_TOOLS, stream: false }),
      signal: AbortSignal.timeout(55000),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

    const data = await res.json() as OllamaApiResponse;
    const { message: msg } = data;

    // Tool calls present → execute each and loop
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        tools_called.push(name);
        const result = await executeTool(name, call.function.arguments);
        messages.push({ role: "tool", content: JSON.stringify(result) });
      }
      continue;
    }

    // No tool calls → final answer
    final_answer = msg.content?.trim() ?? "";
    break;
  }

  return { answer: final_answer, tools_called };
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    message: string;
    neighborhood: string;
    lat: number | null;
    lng: number | null;
    history: SimpleMessage[];
  };

  const { message, neighborhood, lat, lng, history = [] } = body;

  if (!message?.trim() || !neighborhood) {
    return NextResponse.json({ error: "message and neighborhood are required" }, { status: 400 });
  }

  // Pick backend: explicit flag, missing key, or auto-fallback on credit error
  const preferOllama =
    process.env.OLLAMA_FALLBACK === "true" || !process.env.ANTHROPIC_API_KEY;

  const tools_called: string[] = [];
  let final_answer = "";
  let backend = preferOllama ? "ollama" : "claude";

  try {
    let result: { answer: string; tools_called: string[] };

    if (preferOllama) {
      result = await ollamaAgentLoop(message, history, neighborhood, lat, lng);
    } else {
      try {
        result = await claudeAgentLoop(message, history, neighborhood, lat, lng);
      } catch (err) {
        // Auto-fallback when Anthropic account has no credits
        const errMsg = err instanceof Error ? err.message : "";
        if (errMsg.includes("credit balance") || errMsg.includes("too low") || errMsg.includes("quota")) {
          backend = "ollama";
          result = await ollamaAgentLoop(message, history, neighborhood, lat, lng);
        } else {
          throw err;
        }
      }
    }

    final_answer    = result.answer;
    tools_called.push(...result.tools_called);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Agent error (${backend}): ${msg}`, tools_called }, { status: 500 });
  }

  const newTurns: SimpleMessage[] = [
    { role: "user",      content: message },
    ...(final_answer ? [{ role: "assistant" as const, content: final_answer }] : []),
  ];
  const updatedHistory = [...history, ...newTurns].slice(-20);

  return NextResponse.json({ answer: final_answer, tools_called, history: updatedHistory, backend });
}
