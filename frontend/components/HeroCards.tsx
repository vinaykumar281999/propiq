"use client";
import { Property, badge, earnForPeriod, formatMoney, PERIODS, BADGE_INFO } from "@/lib/api";

interface Props {
  properties: Property[];
  onSelect: (p: Property) => void;
  selected: Property | null;
  timePeriod: number;
}

const rankLabel = ["#1 Pick", "#2 Pick", "#3 Pick"];

const badgeConfig = {
  HOT:  {
    pill: "bg-orange-950/80 text-orange-400 border border-orange-800/60",
    grad: "from-orange-950/40 via-navy-900 to-navy-900",
    border: "border-orange-900/80",
    selectedBorder: "border-orange-600",
  },
  WARM: {
    pill: "bg-blue-950/80 text-blue-400 border border-blue-800/60",
    grad: "from-blue-950/40 via-navy-900 to-navy-900",
    border: "border-blue-900/80",
    selectedBorder: "border-blue-600",
  },
  COOL: {
    pill: "bg-gray-900 text-gray-500 border border-gray-700/50",
    grad: "from-navy-900 to-navy-900",
    border: "border-navy-700",
    selectedBorder: "border-gray-500",
  },
};

export default function HeroCards({ properties, onSelect, selected, timePeriod }: Props) {
  const top3 = [...properties].sort((a, b) => b.roi_pct - a.roi_pct).slice(0, 3);
  if (top3.length === 0) return null;

  const period = PERIODS.find((p) => p.months === timePeriod) ?? PERIODS[1];

  return (
    <div className="flex-none px-4 pt-4 pb-4 bg-navy-950 border-b border-navy-800">
      <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-3">
        Top picks right now
      </p>
      <div className="grid grid-cols-3 gap-3">
        {top3.map((p, i) => {
          const b = badge(p.roi_pct);
          const cfg = badgeConfig[b];
          const isSelected = selected?.id === p.id;
          const earn = earnForPeriod(p, timePeriod);

          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className={`text-left rounded-2xl p-4 border bg-gradient-to-br transition-all duration-200 ${cfg.grad} ${
                isSelected
                  ? `${cfg.selectedBorder} shadow-lg shadow-black/60 scale-[1.02]`
                  : `${cfg.border} hover:scale-[1.01] hover:shadow-md hover:shadow-black/40`
              }`}
            >
              {/* Rank + badge row */}
              <div className="flex items-start justify-between mb-3">
                <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mt-0.5">
                  {rankLabel[i]}
                </span>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wide ${cfg.pill} ${b === "HOT" ? "hot-pulse" : ""}`}>
                    {BADGE_INFO[b].label}
                  </span>
                  <span className="text-[9px] text-gray-600 leading-tight text-right max-w-[110px]">
                    {BADGE_INFO[b].subtitle}
                  </span>
                </div>
              </div>

              {/* Name */}
              <p className="text-sm font-bold text-white truncate leading-tight mb-3">
                {p.name}
              </p>

              {/* 3 metrics */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-600">Price</span>
                  <span className="text-[11px] font-semibold text-gray-200">{formatMoney(p.price)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-600">Earn in {period.short}</span>
                  <span className="text-[11px] font-bold text-emerald-400">{formatMoney(earn)}</span>
                </div>
                {p.days_on_market != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-600">Sells in</span>
                    <span className="text-[11px] font-semibold text-gray-400">{Math.round(p.days_on_market)} days</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
