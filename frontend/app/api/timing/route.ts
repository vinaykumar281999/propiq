import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";

// ── Seasonal adjustments (annual %, by JS month index 0=Jan) ─────────────────

const SEASONAL_ADJ: Record<number, number> = {
  11: -1.5, 0: -1.5, 1: -1.5,   // Dec–Feb: winter slowdown
   2:  1.5, 3:  1.5, 4:  1.5,   // Mar–May: spring surge
   5:  0.5, 6:  0.5, 7:  0.5,   // Jun–Aug: summer active
   8: -0.5, 9: -0.5, 10: -0.5,  // Sep–Nov: fall cooling
};

interface SeasonalInfo {
  season:          "Winter" | "Spring" | "Summer" | "Fall";
  condition:       string;
  buyer_power:     "Low" | "Medium" | "High";
  inventory_trend: "Rising" | "Falling" | "Stable";
  historical_tip:  string;
  adjustment_pct:  number;
}

const SEASONAL_INFO: Record<number, SeasonalInfo> = {
  11: { season: "Winter",  condition: "Slow market, fewer competing buyers",     buyer_power: "High",   inventory_trend: "Stable",  historical_tip: "Denver prices are typically 2–3% lower in winter. Less competition gives buyers more negotiating power.",      adjustment_pct: -1.5 },
   0: { season: "Winter",  condition: "Slow market, fewer competing buyers",     buyer_power: "High",   inventory_trend: "Stable",  historical_tip: "January is the quietest month. Motivated sellers are more flexible on price and terms.",                         adjustment_pct: -1.5 },
   1: { season: "Winter",  condition: "Market preparing to heat up",             buyer_power: "High",   inventory_trend: "Rising",  historical_tip: "Late winter is the last window before spring competition surges. Prices start climbing in March.",              adjustment_pct: -1.5 },
   2: { season: "Spring",  condition: "Market heating up, competition rising",   buyer_power: "Medium", inventory_trend: "Rising",  historical_tip: "Spring brings 20–30% more listings and 40% more buyers. Act quickly on well-priced homes.",                     adjustment_pct:  1.5 },
   3: { season: "Spring",  condition: "Peak activity, multiple offers common",   buyer_power: "Low",    inventory_trend: "Rising",  historical_tip: "April is the most competitive month in Denver. Expect 5–15% above asking on desirable properties.",             adjustment_pct:  1.5 },
   4: { season: "Spring",  condition: "High activity, prices near yearly peak",  buyer_power: "Low",    inventory_trend: "Stable",  historical_tip: "May closes peak season. Good selection but elevated prices — final push before summer stabilization.",          adjustment_pct:  1.5 },
   5: { season: "Summer",  condition: "Active market, prices near peak",         buyer_power: "Low",    inventory_trend: "Stable",  historical_tip: "Summer prices in Denver run 2–3% above winter. Family demand drives competition before the school year.",       adjustment_pct:  0.5 },
   6: { season: "Summer",  condition: "Active market, prices near peak",         buyer_power: "Low",    inventory_trend: "Stable",  historical_tip: "July sustains strong demand. Sellers expect list-price offers on well-maintained homes.",                       adjustment_pct:  0.5 },
   7: { season: "Summer",  condition: "Late summer, market beginning to cool",   buyer_power: "Medium", inventory_trend: "Falling", historical_tip: "Late August buyers get slightly better deals as families settle before school year.",                           adjustment_pct:  0.5 },
   8: { season: "Fall",    condition: "Market cooling, more negotiating power",  buyer_power: "Medium", inventory_trend: "Falling", historical_tip: "Fall buyers typically negotiate 1–2% below asking. Less competition, motivated sellers remain.",               adjustment_pct: -0.5 },
   9: { season: "Fall",    condition: "Market slowing, deals emerging",          buyer_power: "High",   inventory_trend: "Falling", historical_tip: "October offers good value — spring/summer inventory remains but prices are softening.",                         adjustment_pct: -0.5 },
  10: { season: "Fall",    condition: "Pre-winter slowdown, buyers have leverage", buyer_power: "High", inventory_trend: "Falling", historical_tip: "November sellers are motivated. Homes sit longer and price reductions become common heading into winter.",      adjustment_pct: -0.5 },
};

// ── Monte Carlo ───────────────────────────────────────────────────────────────

interface HistogramBin {
  price_mid:     number;
  count:         number;
  above_current: boolean;
}

function runMonteCarlo(currentPrice: number, annualRoiPct: number, seasonalPct: number, iterations = 1000) {
  const sixMonthBase = (annualRoiPct / 100) / 2;
  const sixMonthSeasonal = (seasonalPct / 100) / 2;

  const results: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const shock = ((Math.random() * 6) - 3) / 100 / 2; // ±3% annual → 6-month
    const growth = sixMonthBase + shock + sixMonthSeasonal;
    results.push(currentPrice * (1 + growth));
  }
  results.sort((a, b) => a - b);

  const probability_rises = results.filter((r) => r > currentPrice).length / iterations;
  const median  = results[Math.floor(iterations * 0.50)];
  const p10     = results[Math.floor(iterations * 0.10)];
  const p90     = results[Math.floor(iterations * 0.90)];

  // Histogram across inner 98% of range (trim extreme tails)
  const lo   = results[Math.floor(iterations * 0.01)];
  const hi   = results[Math.floor(iterations * 0.99)];
  const BINS = 40;
  const bw   = (hi - lo) / BINS;

  const histogram: HistogramBin[] = Array.from({ length: BINS }, (_, i) => ({
    price_mid:     Math.round(lo + (i + 0.5) * bw),
    count:         0,
    above_current: lo + (i + 0.5) * bw > currentPrice,
  }));

  for (const price of results) {
    const idx = Math.min(Math.floor((price - lo) / bw), BINS - 1);
    if (idx >= 0) histogram[idx].count++;
  }

  return { probability_rises, median, p10, p90, histogram };
}

// ── Rent vs Buy ───────────────────────────────────────────────────────────────

function calcRentVsBuy(budget: number, monthly_rent: number, roiPct: number, currentPrice: number) {
  const down_payment = budget * 0.20;
  const principal    = budget * 0.80;
  const mr = 7.0 / 100 / 12;
  const n  = 360;
  const monthly_mortgage   = principal * (mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
  const monthly_buy_cost   = monthly_mortgage + 300 + (budget * 0.01 / 12);
  const monthly_difference = monthly_buy_cost - monthly_rent;
  const monthly_appreciation = (currentPrice * (roiPct / 100)) / 12;
  const net_monthly_benefit  = monthly_appreciation - Math.max(0, monthly_difference);
  const break_even_months    = net_monthly_benefit > 0 ? Math.round(down_payment / net_monthly_benefit) : Infinity;
  const total_rent_6mo       = monthly_rent * 6;

  return {
    down_payment:         Math.round(down_payment),
    monthly_mortgage:     Math.round(monthly_mortgage),
    monthly_buy_cost:     Math.round(monthly_buy_cost),
    monthly_difference:   Math.round(monthly_difference),
    monthly_appreciation: Math.round(monthly_appreciation),
    net_monthly_benefit:  Math.round(net_monthly_benefit),
    break_even_months:    break_even_months === Infinity ? null : break_even_months,
    total_rent_6mo,
  };
}

// ── Verdict ───────────────────────────────────────────────────────────────────

type Verdict = "BUY_NOW" | "WATCH" | "WAIT";

function buildVerdict(
  probability_rises: number,
  break_even_months: number | null,
  roiPct: number,
  dom: number,
  mc: { median: number; p10: number; p90: number },
  currentPrice: number,
  monthly_difference: number,
): { verdict: Verdict; reasons: [string, string, string] } {
  const be = break_even_months;
  const pRise = probability_rises;
  const risesPct = Math.round(pRise * 100);

  let verdict: Verdict;
  if (pRise > 0.65 && be !== null && be < 36) {
    verdict = "BUY_NOW";
  } else if (pRise < 0.45 || be === null || be > 60) {
    verdict = "WAIT";
  } else {
    verdict = "WATCH";
  }

  const fmt = (n: number) => `$${Math.round(n / 1000)}K`;

  const reasons: [string, string, string] =
    verdict === "BUY_NOW" ? [
      `${risesPct}% probability prices are higher in 6 months — Monte Carlo simulation strongly favors buying now`,
      `Break-even in ${be} months — your investment starts generating positive returns well within a typical holding period`,
      `${roiPct.toFixed(1)}% annual ROI with ${dom}-day market speed confirms high demand in this neighborhood`,
    ] : verdict === "WATCH" ? [
      `${risesPct}% chance prices rise in 6 months — market is balanced, timing window exists but lacks conviction`,
      be !== null
        ? `Break-even at ${be} months — financially viable but monitor for a better entry point`
        : `Monthly premium of $${Math.abs(monthly_difference).toLocaleString()} over renting requires a long hold to recoup`,
      `Median projected 6-month price ${fmt(mc.median)} vs today's ${fmt(currentPrice)} — check back in 60–90 days`,
    ] : [
      `Only ${risesPct}% probability prices rise in 6 months — odds favor waiting for a better entry`,
      be !== null
        ? `Break-even of ${be} months exceeds a typical 5-year hold — renting preserves flexibility`
        : `Property appreciation doesn't offset the monthly buying premium — renting remains financially superior`,
      `${roiPct.toFixed(1)}% ROI and ${dom}-day market time signal soft demand — a better buying window is likely ahead`,
    ];

  return { verdict, reasons };
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    neighborhood:  string;
    budget:        number;
    monthly_rent:  number;
    years_to_stay: number;
  };

  const { neighborhood, budget, monthly_rent, years_to_stay } = body;
  if (!neighborhood?.trim()) {
    return NextResponse.json({ error: "neighborhood is required" }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT name, price, expected_return, days_on_market
    FROM   neighborhoods
    WHERE  name ILIKE '%' || ${neighborhood.trim()} || '%'
    ORDER  BY name
    LIMIT  1
  `;

  if (!rows.length) {
    return NextResponse.json({ error: `No data found for "${neighborhood}"` }, { status: 404 });
  }

  const row          = rows[0];
  const currentPrice = row.price            as number;
  const roiPct       = row.expected_return && currentPrice > 0
    ? Math.round(((row.expected_return as number) / currentPrice) * 10000) / 100
    : 0;
  const dom          = (row.days_on_market as number | null) ?? 30;

  const month        = new Date().getMonth(); // 0=Jan
  const seasonal     = SEASONAL_INFO[month]!;

  // Run Monte Carlo
  const mc = runMonteCarlo(currentPrice, roiPct, seasonal.adjustment_pct);

  // Rent vs Buy
  const rvb = calcRentVsBuy(budget, monthly_rent, roiPct, currentPrice);

  // Verdict
  const { verdict, reasons } = buildVerdict(
    mc.probability_rises,
    rvb.break_even_months,
    roiPct,
    dom,
    { median: mc.median, p10: mc.p10, p90: mc.p90 },
    currentPrice,
    rvb.monthly_difference,
  );

  return NextResponse.json({
    neighborhood: {
      name:          row.name as string,
      current_price: currentPrice,
      roi_pct:       roiPct,
      days_on_market: dom,
    },
    monte_carlo: {
      current_price:     currentPrice,
      median_6mo:        Math.round(mc.median),
      p10_6mo:           Math.round(mc.p10),
      p90_6mo:           Math.round(mc.p90),
      probability_rises: mc.probability_rises,
      histogram:         mc.histogram,
    },
    rent_vs_buy: rvb,
    verdict,
    verdict_reasons: reasons,
    seasonal: {
      ...seasonal,
      month,
      years_to_stay,
    },
  });
}
