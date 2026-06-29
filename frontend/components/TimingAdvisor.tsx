"use client";
import { useEffect, useState } from "react";
import type { Property } from "@/lib/api";

interface Props {
  property: Property;
}

type Verdict = "BUY_NOW" | "WATCH" | "WAIT";
type SignalColor = "emerald" | "amber" | "red";

// ── Mortgage helper ────────────────────────────────────────────────────────────

function monthlyMortgage(price: number, downPct: number, annualRate: number): number {
  const principal = price * (1 - downPct / 100);
  const mr = annualRate / 100 / 12;
  const n = 360;
  if (mr === 0) return principal / n;
  return principal * (mr * Math.pow(1 + mr, n)) / (Math.pow(1 + mr, n) - 1);
}

// ── SignalCard ─────────────────────────────────────────────────────────────────

const SIGNAL_COLORS: Record<SignalColor, { text: string; bg: string; border: string }> = {
  emerald: { text: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-700/40" },
  amber:   { text: "text-amber-400",   bg: "bg-amber-950/40",   border: "border-amber-700/40"   },
  red:     { text: "text-red-400",     bg: "bg-red-950/40",     border: "border-red-700/40"     },
};

function SignalCard({
  label, value, icon, color, sub,
}: { label: string; value: string; icon: string; color: SignalColor; sub: string }) {
  const c = SIGNAL_COLORS[color];
  return (
    <div className={`rounded-xl p-2.5 border ${c.bg} ${c.border}`}>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-none">{icon}</span>
        <span className={`text-sm font-black leading-none ${c.text}`}>{value}</span>
      </div>
      <p className="text-[9px] text-slate-600 mt-1">{sub}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TimingAdvisor({ property }: Props) {
  const roi = property.roi_pct;
  const dom = property.days_on_market ?? 30;

  // ── Section 1: Buy / Watch / Wait ──────────────────────────────────────────

  const verdict: Verdict =
    roi > 6 && dom < 20                             ? "BUY_NOW" :
    roi >= 3 && roi <= 6 && dom >= 20 && dom <= 40  ? "WATCH"   :
                                                       "WAIT";

  const VERDICT_CFG = {
    BUY_NOW: {
      label:  "BUY NOW",
      bg:     "bg-emerald-950/50 border-emerald-600/40",
      text:   "text-emerald-400",
      bar:    "bg-gradient-to-r from-emerald-500 to-emerald-400",
      reason: "Strong appreciation and fast-moving market. Waiting risks paying more.",
    },
    WATCH: {
      label:  "WATCH",
      bg:     "bg-amber-950/50 border-amber-600/40",
      text:   "text-amber-400",
      bar:    "bg-gradient-to-r from-amber-500 to-amber-400",
      reason: "Moderate market. Monitor for price drops before committing.",
    },
    WAIT: {
      label:  "WAIT",
      bg:     "bg-red-950/50 border-red-600/40",
      text:   "text-red-400",
      bar:    "bg-gradient-to-r from-red-600 to-red-500",
      reason: "Slow market with weak appreciation. Better opportunities likely ahead.",
    },
  } as const;

  const cfg = VERDICT_CFG[verdict];
  const probability = Math.min(95, Math.max(30, Math.round(roi * 8 + 40)));

  // ── Section 2: Rent vs Buy ─────────────────────────────────────────────────

  const [rent,    setRent]    = useState(2000);
  const [price,   setPrice]   = useState(property.price);
  const [downPct, setDownPct] = useState(20);
  const [rate,    setRate]    = useState(7.0);

  // Sync purchase price when neighborhood changes
  useEffect(() => { setPrice(property.price); }, [property.price]);

  const mortgage        = monthlyMortgage(price, downPct, rate);
  const downPayment     = price * downPct / 100;
  const monthlyDiff     = mortgage - rent;                             // + = buying costs more
  const appreciation    = (price * roi / 100) / 12;                   // monthly price gain
  const netBenefit      = appreciation - Math.max(0, monthlyDiff);    // total monthly benefit of owning
  const breakEvenMonths = netBenefit > 0 ? Math.round(downPayment / netBenefit) : Infinity;

  const breakEvenLabel =
    breakEvenMonths < 24   ? "Buying makes financial sense"
    : breakEvenMonths <= 60 ? `Buying pays off in ${Math.round(breakEvenMonths / 12)} yrs`
    :                          "Renting is cheaper short-term";

  const breakEvenColor =
    breakEvenMonths < 24   ? "text-emerald-400"
    : breakEvenMonths <= 60 ? "text-amber-400"
    :                          "text-red-400";

  // ── Section 3: Market signals ──────────────────────────────────────────────

  const timingScore = Math.min(100, Math.max(0,
    Math.round(Math.min(50, roi * 5) + (dom < 20 ? 50 : dom <= 40 ? 25 : 0)),
  ));
  const sixMonthPct    = (roi / 2).toFixed(1);
  const sixMonthDollar = Math.round((price * roi / 100) * 0.5 / 1000);

  return (
    <div className="px-4 pt-3 pb-4 space-y-3">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        Buy Now or Wait?
      </p>

      {/* ── Section 1: Timing verdict ───────────────────────────────────────── */}
      <div className={`rounded-xl p-3 border ${cfg.bg}`}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className={`text-xl font-black leading-none ${cfg.text}`}>{cfg.label}</span>
          <span className="text-[9px] text-slate-400 text-right leading-tight">
            {probability}% chance<br />prices higher in 6mo
          </span>
        </div>
        <p className="text-[11px] text-slate-300 leading-relaxed mb-2">{cfg.reason}</p>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
            style={{ width: `${probability}%` }}
          />
        </div>
      </div>

      {/* ── Section 2: Rent vs Buy ───────────────────────────────────────────── */}
      <div className="bg-[#161B30] border border-slate-800/60 rounded-xl p-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">
          Rent vs Buy
        </p>

        <div className="grid grid-cols-2 gap-2">
          {/* Monthly rent */}
          <label className="block">
            <span className="text-[9px] text-slate-500">Monthly Rent</span>
            <div className="relative mt-0.5">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] select-none">$</span>
              <input
                type="number"
                value={rent}
                onChange={(e) => setRent(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#0F1322] border border-slate-700/60 text-slate-100 text-[11px] rounded-lg pl-5 pr-2 py-1.5 focus:outline-none focus:border-emerald-400/60 transition-colors"
              />
            </div>
          </label>

          {/* Down payment */}
          <label className="block">
            <span className="text-[9px] text-slate-500">Down Payment</span>
            <div className="relative mt-0.5">
              <input
                type="number"
                value={downPct}
                min={0}
                max={100}
                onChange={(e) => setDownPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                className="w-full bg-[#0F1322] border border-slate-700/60 text-slate-100 text-[11px] rounded-lg pl-3 pr-5 py-1.5 focus:outline-none focus:border-emerald-400/60 transition-colors"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] select-none">%</span>
            </div>
          </label>

          {/* Interest rate */}
          <label className="block">
            <span className="text-[9px] text-slate-500">Interest Rate</span>
            <div className="relative mt-0.5">
              <input
                type="number"
                step="0.1"
                value={rate}
                min={0}
                onChange={(e) => setRate(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#0F1322] border border-slate-700/60 text-slate-100 text-[11px] rounded-lg pl-3 pr-5 py-1.5 focus:outline-none focus:border-emerald-400/60 transition-colors"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] select-none">%</span>
            </div>
          </label>

          {/* Purchase price */}
          <label className="block">
            <span className="text-[9px] text-slate-500">Purchase Price</span>
            <div className="relative mt-0.5">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-[10px] select-none">$</span>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value)))}
                className="w-full bg-[#0F1322] border border-slate-700/60 text-slate-100 text-[11px] rounded-lg pl-5 pr-2 py-1.5 focus:outline-none focus:border-emerald-400/60 transition-colors"
              />
            </div>
          </label>
        </div>

        {/* Results rows */}
        <div className="mt-2.5 space-y-1.5 border-t border-slate-800/60 pt-2.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Monthly mortgage</span>
            <span className="text-slate-200 font-semibold">${Math.round(mortgage).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Monthly rent</span>
            <span className="text-slate-200 font-semibold">${rent.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Monthly difference</span>
            <span className={`font-bold ${monthlyDiff > 0 ? "text-red-400" : "text-emerald-400"}`}>
              {monthlyDiff > 0
                ? `+$${Math.round(monthlyDiff).toLocaleString()} to buy`
                : `-$${Math.round(-monthlyDiff).toLocaleString()} saved`}
            </span>
          </div>
          <div className="flex justify-between items-center text-[11px] border-t border-slate-800/60 pt-1.5 mt-1">
            <span className="text-slate-400">Verdict</span>
            <span className={`font-bold text-[10px] ${breakEvenColor}`}>{breakEvenLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Section 3: Market signals 2×2 grid ─────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
          Market Signals
        </p>
        <div className="grid grid-cols-2 gap-2">
          <SignalCard
            label="Price Momentum"
            value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`}
            icon={roi >= 6 ? "↑" : roi >= 3 ? "→" : "↓"}
            color={roi >= 6 ? "emerald" : roi >= 3 ? "amber" : "red"}
            sub="annual ROI"
          />
          <SignalCard
            label="Market Speed"
            value={dom < 20 ? "Fast" : dom <= 40 ? "Normal" : "Slow"}
            icon={dom < 20 ? "⚡" : dom <= 40 ? "⏱" : "🐢"}
            color={dom < 20 ? "emerald" : dom <= 40 ? "amber" : "red"}
            sub={`${dom} days avg`}
          />
          <SignalCard
            label="Timing Score"
            value={`${timingScore}/100`}
            icon={timingScore >= 70 ? "🎯" : timingScore >= 40 ? "📊" : "⚠️"}
            color={timingScore >= 70 ? "emerald" : timingScore >= 40 ? "amber" : "red"}
            sub="composite"
          />
          <SignalCard
            label="6-Month Outlook"
            value={`+${sixMonthPct}%`}
            icon="📈"
            color={roi >= 4 ? "emerald" : roi >= 2 ? "amber" : "red"}
            sub={`+$${sixMonthDollar}K projected`}
          />
        </div>
      </div>

    </div>
  );
}
