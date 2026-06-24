"use client";
import { Property, verdict, projections, formatMoney, earnForPeriod, PERIODS } from "@/lib/api";
import ProjectionChart from "./ProjectionChart";

interface Props {
  property: Property | null;
  timePeriod: number;
  setTimePeriod: (n: number) => void;
}

const verdictConfig = {
  BUY: {
    label: "Great Investment",
    emoji: "✅",
    headlineTag: "a HOT market 🔥",
    bg: "bg-indigo-950/60 border-indigo-800/50",
    text: "text-indigo-400",
  },
  HOLD: {
    label: "Maybe — Watch It",
    emoji: "👀",
    headlineTag: "a solid market 📊",
    bg: "bg-amber-950/60 border-amber-800/50",
    text: "text-amber-400",
  },
  AVOID: {
    label: "Avoid for Now",
    emoji: "⚠️",
    headlineTag: "a slow market",
    bg: "bg-red-950/50 border-red-900/50",
    text: "text-red-400",
  },
};

function StatCard({ icon, headline, sub }: { icon: string; headline: string; sub: string }) {
  return (
    <div className="bg-navy-900 rounded-xl p-4 border border-navy-700 flex gap-3 items-start">
      <span className="text-2xl leading-none mt-0.5">{icon}</span>
      <div>
        <p className="text-base font-bold text-white leading-tight">{headline}</p>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

export default function PropertyPanel({ property, timePeriod, setTimePeriod }: Props) {
  const period = PERIODS.find((p) => p.months === timePeriod) ?? PERIODS[1];

  return (
    <div className="h-full flex flex-col">

      {/* Period selector — always visible at top */}
      <div className="flex-none bg-navy-900/80 border-b border-navy-800 px-5 py-2.5 flex items-center gap-1.5">
        <span className="text-[11px] text-gray-600 mr-1.5 whitespace-nowrap">Returns for</span>
        {PERIODS.map((p) => (
          <button
            key={p.months}
            onClick={() => setTimePeriod(p.months)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              timePeriod === p.months
                ? "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50"
                : "text-gray-500 hover:text-gray-200 hover:bg-navy-700"
            }`}
          >
            {p.short}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {!property ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-700 select-none gap-3">
            <div className="text-7xl opacity-20">🏘</div>
            <p className="text-sm text-gray-600">Pick a neighborhood on the left to see the full breakdown</p>
          </div>
        ) : (
          <PropertyDetail property={property} timePeriod={timePeriod} period={period} />
        )}
      </div>
    </div>
  );
}

function PropertyDetail({
  property,
  timePeriod,
  period,
}: {
  property: Property;
  timePeriod: number;
  period: typeof PERIODS[number];
}) {
  const v = verdict(property.roi_pct);
  const cfg = verdictConfig[v];
  const pts = projections(property, timePeriod);
  const earn = earnForPeriod(property, timePeriod);
  const yoyPct = property.roi_pct;
  const priceFormatted = formatMoney(property.price);
  const futurePrice = formatMoney(property.price + earn);

  const scenarios = [
    { label: "Conservative", sub: "Slower-than-expected growth", mult: 0.5,  color: "text-gray-400" },
    { label: "Moderate",     sub: "Growth continues as expected", mult: 1.0, color: "text-emerald-400" },
    { label: "Optimistic",   sub: "Strong market acceleration",   mult: 1.5, color: "text-indigo-400" },
  ];

  return (
    <>
      {/* Hero number banner */}
      <div className="bg-gradient-to-r from-navy-900 via-navy-800/80 to-navy-950 border-b border-navy-700/60 px-6 py-5">
        <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-1">
          Potential return in {period.label}
        </p>
        <p className="text-5xl font-black text-emerald-400 leading-none tracking-tight">
          {formatMoney(earn)}
        </p>
        <p className="text-sm text-gray-500 mt-1.5">
          if you invest in {property.name} today
        </p>
      </div>

      <div className="p-6 space-y-5 max-w-2xl">

        {/* Headline */}
        <div>
          <h2 className="text-2xl font-bold text-white leading-snug">
            {property.name} is {cfg.headlineTag}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{property.metro?.replace(" metro area", "") ?? ""}</p>
        </div>

        {/* Verdict pill */}
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold ${cfg.bg} ${cfg.text}`}>
          <span>{cfg.emoji}</span>
          <span>{cfg.label}</span>
        </div>

        {/* Narrative */}
        <div className="bg-navy-900/60 border border-navy-700 rounded-xl p-4">
          <p className="text-sm text-gray-400 leading-relaxed">
            If you buy this home for <span className="text-gray-200 font-semibold">{priceFormatted}</span>,
            based on how this neighborhood is growing, in {period.label} it could be worth{" "}
            <span className="text-gray-200 font-semibold">{futurePrice}</span> — a potential gain of{" "}
            <span className="text-emerald-400 font-semibold">{formatMoney(earn)}</span>.
          </p>
        </div>

        {/* 4 stat cards */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon="💰"
            headline={`${formatMoney(earn)} in ${period.label}`}
            sub="Estimated return at current growth rate"
          />
          <StatCard
            icon="📈"
            headline={`+${yoyPct}% per year`}
            sub="Annual price growth (year over year)"
          />
          {property.days_on_market != null ? (
            <StatCard
              icon="⚡"
              headline={`Sells in ${Math.round(property.days_on_market)} days`}
              sub={property.days_on_market <= 14 ? "Very fast — high demand" : property.days_on_market <= 30 ? "Moves quickly" : "Takes a bit longer"}
            />
          ) : (
            <StatCard icon="🏠" headline={priceFormatted} sub="Current listing price" />
          )}
          <StatCard
            icon="🏠"
            headline={priceFormatted}
            sub="Current median sale price in this area"
          />
        </div>

        {/* 3 scenarios */}
        <div>
          <p className="text-sm font-semibold text-gray-300 mb-3">Return scenarios for {period.label}</p>
          <div className="space-y-2">
            {scenarios.map(({ label, sub, mult, color }) => (
              <div key={label} className="flex items-center justify-between bg-navy-900 rounded-xl px-4 py-3 border border-navy-700">
                <div>
                  <p className="text-sm font-medium text-gray-200">{label}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{sub}</p>
                </div>
                <p className={`text-xl font-bold ${color}`}>
                  {formatMoney(Math.round(earn * mult))}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Projection chart */}
        <div>
          <p className="text-sm font-semibold text-gray-300 mb-1">Growth over {period.label}</p>
          <p className="text-xs text-gray-600 mb-3">Month-by-month estimate based on current trajectory</p>
          <div className="bg-navy-900 rounded-xl p-4 border border-navy-700">
            <ProjectionChart points={pts} totalMonths={timePeriod} />
          </div>
          <div className={`grid gap-2 mt-3 ${pts.length <= 4 ? "grid-cols-4" : pts.length === 5 ? "grid-cols-5" : "grid-cols-6"}`}>
            {pts.map((pt) => (
              <div key={pt.month} className="text-center">
                <p className="text-xs text-gray-600">{fmtMonth(pt.month)}</p>
                <p className="text-xs font-bold text-gray-300">{formatMoney(pt.value)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Verdict banner */}
        <div className={`rounded-xl p-5 border ${cfg.bg}`}>
          <p className={`text-lg font-bold ${cfg.text} mb-1`}>{cfg.emoji} {cfg.label}</p>
          <p className="text-sm text-gray-400 leading-relaxed">
            {v === "BUY" &&
              `${property.name} is growing faster than most neighborhoods. Homes here move quickly and prices are rising — a strong place to invest right now.`}
            {v === "HOLD" &&
              `${property.name} is a steady market — not skyrocketing, but not falling either. A good fit if you plan to hold for several years.`}
            {v === "AVOID" &&
              `${property.name} is growing slowly right now. Your money would likely work harder in a faster-moving neighborhood. Keep an eye on it.`}
          </p>
        </div>

      </div>
    </>
  );
}

function fmtMonth(month: number): string {
  if (month % 12 === 0) return `Y${month / 12}`;
  if (month >= 24) return `M${month}`;
  return `M${month}`;
}
