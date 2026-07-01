"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";

// ── Types (mirrors API response) ──────────────────────────────────────────────

interface HistogramBin {
  price_mid:     number;
  count:         number;
  above_current: boolean;
}

interface TimingAnalysis {
  neighborhood: {
    name:           string;
    current_price:  number;
    roi_pct:        number;
    days_on_market: number;
  };
  monte_carlo: {
    current_price:     number;
    median_6mo:        number;
    p10_6mo:           number;
    p90_6mo:           number;
    probability_rises: number;
    histogram:         HistogramBin[];
  };
  rent_vs_buy: {
    down_payment:         number;
    monthly_mortgage:     number;
    monthly_buy_cost:     number;
    monthly_difference:   number;
    monthly_appreciation: number;
    net_monthly_benefit:  number;
    break_even_months:    number | null;
    total_rent_6mo:       number;
  };
  verdict:         "BUY_NOW" | "WATCH" | "WAIT";
  verdict_reasons: [string, string, string];
  seasonal: {
    season:          string;
    condition:       string;
    buyer_power:     "Low" | "Medium" | "High";
    inventory_trend: "Rising" | "Falling" | "Stable";
    historical_tip:  string;
    adjustment_pct:  number;
    years_to_stay:   number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtFull(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

const VERDICT_CFG = {
  BUY_NOW: {
    label: "BUY NOW",
    sub:   "Strong conditions favor purchasing today",
    bg:    "from-emerald-950/80 to-emerald-900/40",
    border:"border-emerald-600/40",
    text:  "text-emerald-400",
    badge: "bg-emerald-500/20 border-emerald-500/50 text-emerald-300",
  },
  WATCH: {
    label: "WATCH 90 DAYS",
    sub:   "Market is balanced — monitor before committing",
    bg:    "from-amber-950/80 to-amber-900/40",
    border:"border-amber-600/40",
    text:  "text-amber-400",
    badge: "bg-amber-500/20 border-amber-500/50 text-amber-300",
  },
  WAIT: {
    label: "WAIT 6 MONTHS",
    sub:   "Better entry points likely ahead",
    bg:    "from-red-950/80 to-red-900/40",
    border:"border-red-600/40",
    text:  "text-red-400",
    badge: "bg-red-500/20 border-red-500/50 text-red-300",
  },
} as const;

// ── Chart ─────────────────────────────────────────────────────────────────────

function MonteCarloChart({ histogram, currentPrice }: { histogram: HistogramBin[]; currentPrice: number }) {
  // Find the bin closest to current price for the reference line label
  const closest = histogram.reduce((best, bin) =>
    Math.abs(bin.price_mid - currentPrice) < Math.abs(best.price_mid - currentPrice) ? bin : best,
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart
        data={histogram}
        margin={{ top: 8, right: 12, bottom: 24, left: 8 }}
        barCategoryGap="2%"
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="price_mid"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => `${fmt(v)}`}
          tick={{ fill: "#64748b", fontSize: 9 }}
          tickLine={false}
          axisLine={false}
          label={{ value: "Simulated 6-month price", position: "insideBottom", offset: -14, fill: "#475569", fontSize: 9 }}
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 9 }}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload as HistogramBin;
            return (
              <div className="bg-[#0f1322] border border-slate-700/60 rounded-xl px-3 py-2 text-[10px]">
                <p className="text-slate-400">~{fmt(d.price_mid)}</p>
                <p className={`font-bold ${d.above_current ? "text-emerald-400" : "text-red-400"}`}>
                  {d.count} scenario{d.count !== 1 ? "s" : ""}
                </p>
                <p className="text-slate-500">{d.above_current ? "↑ above today" : "↓ below today"}</p>
              </div>
            );
          }}
        />
        <ReferenceLine
          x={closest.price_mid}
          stroke="#94a3b8"
          strokeDasharray="4 3"
          strokeWidth={1.5}
          label={{ value: "Today", position: "top", fill: "#94a3b8", fontSize: 9 }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {histogram.map((bin, i) => (
            <Cell
              key={i}
              fill={bin.above_current ? "#10b981" : "#ef4444"}
              fillOpacity={0.65}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Section cards ─────────────────────────────────────────────────────────────

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-[#0F1322]/80 border border-slate-800/60 rounded-2xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">{children}</p>
  );
}

function Row({ label, value, valueClass = "text-slate-200" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-800/40 last:border-0">
      <span className="text-[12px] text-slate-400">{label}</span>
      <span className={`text-[12px] font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}

function PowerBadge({ level }: { level: "Low" | "Medium" | "High" }) {
  const cfg = { Low: "text-red-400 bg-red-950/50 border-red-700/40", Medium: "text-amber-400 bg-amber-950/50 border-amber-700/40", High: "text-emerald-400 bg-emerald-950/50 border-emerald-700/40" };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg[level]}`}>{level}</span>;
}

function TrendBadge({ trend }: { trend: "Rising" | "Falling" | "Stable" }) {
  const cfg = { Rising: "text-emerald-400 bg-emerald-950/50 border-emerald-700/40", Falling: "text-red-400 bg-red-950/50 border-red-700/40", Stable: "text-slate-300 bg-slate-800/50 border-slate-700/40" };
  const icon = { Rising: "↑", Falling: "↓", Stable: "→" };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg[trend]}`}>{icon[trend]} {trend}</span>;
}

// ── Signal mini-card ─────────────────────────────────────────────────────────

function Signal({ label, value, sub, color }: { label: string; value: string; sub: string; color: "emerald" | "amber" | "red" }) {
  const c = {
    emerald: { text: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-700/40" },
    amber:   { text: "text-amber-400",   bg: "bg-amber-950/40",   border: "border-amber-700/40"   },
    red:     { text: "text-red-400",     bg: "bg-red-950/40",     border: "border-red-700/40"     },
  }[color];
  return (
    <div className={`rounded-xl p-3.5 border ${c.bg} ${c.border}`}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
      <p className={`text-base font-black leading-none ${c.text}`}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

// ── Seasonal warning banner ─────────────────────────────────────────────────
// Peak buying season (Jun-Aug, 0-indexed 5-7) — prices historically run
// higher and buyers have less negotiating leverage than in the fall.

function isPeakSeason() {
  const month = new Date().getMonth();
  return month >= 5 && month <= 7;
}

function SeasonalWarningBanner() {
  if (!isPeakSeason()) return null;
  return (
    <div className="rounded-xl px-4 py-3 border bg-amber-950/40 border-amber-700/40 flex items-start gap-2.5">
      <span className="text-amber-400 text-sm flex-none mt-0.5">⚠</span>
      <p className="text-[12px] text-amber-200 leading-relaxed">
        <span className="font-bold">You&apos;re buying at peak season</span> — prices are typically
        3-5% higher than winter. Consider waiting until Oct-Nov for more negotiating power.
      </p>
    </div>
  );
}

// ── Copy link button ─────────────────────────────────────────────────────────

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-[11px] font-semibold text-slate-400 hover:text-emerald-400 border border-slate-700/60 hover:border-emerald-500/40 rounded-lg px-3 py-1.5 transition-all flex items-center gap-1.5"
    >
      {copied ? "✓ Copied" : "🔗 Copy link"}
    </button>
  );
}

// ── Results ───────────────────────────────────────────────────────────────────

function Results({ result }: { result: TimingAnalysis }) {
  const cfg = VERDICT_CFG[result.verdict];
  const mc  = result.monte_carlo;
  const rvb = result.rent_vs_buy;
  const s   = result.seasonal;
  const n   = result.neighborhood;

  const priceToRentRatio = n.current_price / (rvb.monthly_mortgage * 12);

  return (
    <div className="space-y-4 mt-8">

      <SeasonalWarningBanner />

      {/* A — Verdict */}
      <div className={`rounded-2xl p-6 border bg-gradient-to-br ${cfg.bg} ${cfg.border}`}>
        <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Timing Verdict · {n.name}</p>
            <p className={`text-4xl font-black leading-none ${cfg.text}`}>{cfg.label}</p>
            <p className="text-[13px] text-slate-400 mt-2">{cfg.sub}</p>
          </div>
          <div className="text-right flex flex-col items-end gap-2">
            <CopyLinkButton />
            <div>
              <p className="text-[10px] text-slate-500 mb-1">Expected price</p>
              <p className="text-slate-300 text-sm font-semibold">
                {fmt(mc.current_price)} <span className="text-slate-500">→</span>{" "}
                <span className={cfg.text}>{fmt(mc.median_6mo)}</span>
              </p>
              <p className="text-[10px] text-slate-500 mt-1">
                Range: {fmt(mc.p10_6mo)} – {fmt(mc.p90_6mo)}
              </p>
            </div>
          </div>
        </div>
        <ul className="space-y-2">
          {result.verdict_reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[12px] text-slate-300 leading-relaxed">
              <span className={`flex-none mt-0.5 text-[10px] font-black ${cfg.text}`}>▶</span>
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* B + C — Monte Carlo + Rent vs Buy */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* B — Monte Carlo chart */}
        <SectionCard>
          <SectionLabel>Monte Carlo Simulation · 1,000 scenarios</SectionLabel>
          <div className="flex gap-4 mb-3 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70 inline-block" />
              <span className="text-slate-300">{Math.round(mc.probability_rises * 100)}% prices rise</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500/70 inline-block" />
              <span className="text-slate-300">{Math.round((1 - mc.probability_rises) * 100)}% prices fall</span>
            </span>
          </div>
          <MonteCarloChart histogram={mc.histogram} currentPrice={mc.current_price} />
        </SectionCard>

        {/* C — Rent vs Buy */}
        <SectionCard>
          <SectionLabel>Rent vs Buy Analysis</SectionLabel>
          <div className="space-y-0">
            <Row label="Monthly mortgage (7%, 30yr)"  value={fmtFull(rvb.monthly_mortgage)} />
            <Row label="HOA + taxes + maintenance"     value={`$${(300 + Math.round(rvb.monthly_buy_cost - rvb.monthly_mortgage - 300 + 300)).toLocaleString()}/mo`} />
            <Row label="Total monthly buy cost"        value={fmtFull(rvb.monthly_buy_cost)} />
            <Row
              label="vs. monthly rent"
              value={rvb.monthly_difference > 0 ? `+${fmtFull(rvb.monthly_difference)} more` : `${fmtFull(-rvb.monthly_difference)} less`}
              valueClass={rvb.monthly_difference > 0 ? "text-red-400" : "text-emerald-400"}
            />
            <Row label="Monthly appreciation (est.)"  value={`+${fmtFull(rvb.monthly_appreciation)}`} valueClass="text-emerald-400" />
            <Row
              label="Break-even"
              value={rvb.break_even_months !== null ? `${rvb.break_even_months} months` : "Long-term hold"}
              valueClass={
                rvb.break_even_months !== null && rvb.break_even_months < 36 ? "text-emerald-400"
                : rvb.break_even_months !== null && rvb.break_even_months < 60 ? "text-amber-400"
                : "text-red-400"
              }
            />
            <Row label="Rent paid in 6 months of waiting" value={`-${fmtFull(rvb.total_rent_6mo)}`} valueClass="text-red-400" />
          </div>
        </SectionCard>
      </div>

      {/* D + E — Seasonal + Market Signals */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* D — Seasonal */}
        <SectionCard>
          <SectionLabel>Seasonal Timing</SectionLabel>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-slate-800/60 border border-slate-700/60 flex items-center justify-center text-xl">
              {{ Winter: "❄️", Spring: "🌸", Summer: "☀️", Fall: "🍂" }[s.season]}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-200">{s.season}</p>
              <p className="text-[11px] text-slate-400">{s.condition}</p>
            </div>
          </div>
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-slate-400">Buyer power</span>
              <PowerBadge level={s.buyer_power} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-slate-400">Inventory trend</span>
              <TrendBadge trend={s.inventory_trend} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-slate-400">Seasonal factor</span>
              <span className={`text-[12px] font-semibold ${s.adjustment_pct >= 0 ? "text-amber-400" : "text-emerald-400"}`}>
                {s.adjustment_pct >= 0 ? "+" : ""}{s.adjustment_pct}% / yr
              </span>
            </div>
          </div>
          <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Historical Insight</p>
            <p className="text-[11px] text-slate-300 leading-relaxed">{s.historical_tip}</p>
          </div>
        </SectionCard>

        {/* E — Market Signals */}
        <SectionCard>
          <SectionLabel>Market Signals · {n.name}</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5">
            <Signal
              label="Price Momentum"
              value={`${n.roi_pct >= 0 ? "+" : ""}${n.roi_pct.toFixed(1)}%`}
              sub="annual ROI"
              color={n.roi_pct >= 6 ? "emerald" : n.roi_pct >= 3 ? "amber" : "red"}
            />
            <Signal
              label="Market Speed"
              value={n.days_on_market < 20 ? "Fast" : n.days_on_market <= 40 ? "Normal" : "Slow"}
              sub={`${n.days_on_market} days avg`}
              color={n.days_on_market < 20 ? "emerald" : n.days_on_market <= 40 ? "amber" : "red"}
            />
            <Signal
              label="Inventory Signal"
              value={s.inventory_trend}
              sub={s.inventory_trend === "Rising" ? "more choice" : s.inventory_trend === "Falling" ? "fewer options" : "balanced"}
              color={s.inventory_trend === "Falling" ? "red" : s.inventory_trend === "Rising" ? "emerald" : "amber"}
            />
            <Signal
              label="Price / Rent Ratio"
              value={priceToRentRatio.toFixed(0) + "×"}
              sub={priceToRentRatio < 15 ? "buy favored" : priceToRentRatio < 20 ? "balanced" : "rent favored"}
              color={priceToRentRatio < 15 ? "emerald" : priceToRentRatio < 20 ? "amber" : "red"}
            />
          </div>
        </SectionCard>

      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TimingPage() {
  const [location,    setLocation]    = useState("");
  const [budget,      setBudget]      = useState(500000);
  const [monthlyRent, setMonthlyRent] = useState(2000);
  const [yearsToStay, setYearsToStay] = useState(5);

  const [allNames,     setAllNames]     = useState<string[]>([]);
  const [suggestions,  setSuggestions]  = useState<string[]>([]);
  const [showDrop,     setShowDrop]     = useState(false);

  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<TimingAnalysis | null>(null);
  const [error,   setError]   = useState("");

  const inputRef     = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load neighborhood names once
  useEffect(() => {
    fetch("/api/properties?limit=2000")
      .then((r) => r.json())
      .then((d) => setAllNames((d.properties ?? []).map((p: { name: string }) => p.name)))
      .catch(() => {});
  }, []);

  // Filter autocomplete
  useEffect(() => {
    const q = location.trim().toLowerCase();
    if (q.length < 2) { setSuggestions([]); return; }
    setSuggestions(
      allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 8),
    );
  }, [location, allNames]);

  // Close dropdown on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const analyze = async () => {
    if (!location.trim()) { inputRef.current?.focus(); return; }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ neighborhood: location, budget, monthly_rent: monthlyRent, years_to_stay: yearsToStay }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analysis failed");
      setResult(data as TimingAnalysis);
      setTimeout(() => window.scrollTo({ top: 400, behavior: "smooth" }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070A13] text-slate-100">

      {/* Header */}
      <header className="border-b border-slate-800/60 bg-[#0F1322]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center font-black text-sm text-black">
                P
              </div>
              <span className="font-black text-[16px] bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                PropIQ
              </span>
            </Link>
            <span className="text-slate-700">/</span>
            <span className="text-[13px] font-semibold text-slate-300">Timing Advisor</span>
          </div>
          <Link
            href="/"
            className="text-[11px] font-semibold text-slate-400 hover:text-emerald-400 border border-slate-700/60 hover:border-emerald-500/40 rounded-lg px-3 py-1.5 transition-all"
          >
            ← Back to Map
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-4xl mx-auto px-4 pt-10 pb-6">
        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-2">Monte Carlo Analysis</p>
        <h1 className="text-3xl font-black leading-tight text-slate-100 mb-2">
          Should I Buy in{" "}
          <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            {location || "Denver"}
          </span>{" "}
          Now or Wait?
        </h1>
        <p className="text-[13px] text-slate-400">
          1,000-scenario simulation using historical appreciation, seasonal factors, and your financial profile.
        </p>
      </div>

      {/* Input form */}
      <div className="max-w-4xl mx-auto px-4 pb-4">
        <div className="bg-[#0F1322]/80 border border-slate-800/60 rounded-2xl p-5 shadow-2xl shadow-black/40">

          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">Your Situation</p>

          <div className="grid sm:grid-cols-2 gap-4">

            {/* Location */}
            <div className="sm:col-span-2" ref={containerRef}>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">Location / Neighborhood</label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={location}
                  onChange={(e) => { setLocation(e.target.value); setShowDrop(true); }}
                  onFocus={() => setShowDrop(true)}
                  placeholder="e.g. Capitol Hill, Cherry Creek, Stapleton…"
                  className="w-full bg-[#161B30] border border-slate-700/60 text-slate-100 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-400/60 placeholder-slate-600 transition-colors"
                />
                {showDrop && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#161B30]/98 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
                    {suggestions.map((name, i) => (
                      <button
                        key={name}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setLocation(name);
                          setSuggestions([]);
                          setShowDrop(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-[12px] text-slate-200 hover:bg-slate-700/40 transition-colors ${i < suggestions.length - 1 ? "border-b border-slate-800/60" : ""}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Budget */}
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">My Budget</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">$</span>
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Math.max(0, Number(e.target.value)))}
                  className="w-full bg-[#161B30] border border-slate-700/60 text-slate-100 text-sm rounded-xl pl-7 pr-4 py-2.5 focus:outline-none focus:border-emerald-400/60 transition-colors"
                />
              </div>
            </div>

            {/* Monthly rent */}
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">Current Monthly Rent</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">$</span>
                <input
                  type="number"
                  value={monthlyRent}
                  onChange={(e) => setMonthlyRent(Math.max(0, Number(e.target.value)))}
                  className="w-full bg-[#161B30] border border-slate-700/60 text-slate-100 text-sm rounded-xl pl-7 pr-4 py-2.5 focus:outline-none focus:border-emerald-400/60 transition-colors"
                />
              </div>
            </div>

            {/* Time horizon */}
            <div>
              <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">How Long I Plan to Stay</label>
              <select
                value={yearsToStay}
                onChange={(e) => setYearsToStay(Number(e.target.value))}
                className="w-full appearance-none bg-[#161B30] border border-slate-700/60 text-slate-100 text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-400/60 transition-colors cursor-pointer"
              >
                <option value={2}>2 years</option>
                <option value={5}>5 years</option>
                <option value={10}>10 years</option>
                <option value={30}>Forever</option>
              </select>
            </div>

            {/* Analyze button */}
            <div className="flex items-end">
              <button
                onClick={analyze}
                disabled={loading || !location.trim()}
                className="w-full py-2.5 rounded-xl font-bold text-[13px] tracking-wide transition-all bg-gradient-to-r from-emerald-500 to-cyan-400 text-black shadow-lg shadow-emerald-900/40 hover:from-emerald-400 hover:to-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    Running simulation…
                  </>
                ) : (
                  <>⚡ Analyze</>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-red-950/50 border border-red-700/50 text-[12px] text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        {result && <Results result={result} />}
      </div>

    </div>
  );
}
