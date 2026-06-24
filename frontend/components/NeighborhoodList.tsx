"use client";
import { Property, badge, formatMoney } from "@/lib/api";
import Sparkline from "./Sparkline";

interface Props {
  properties: Property[];
  search: string;
  selected: Property | null;
  onSelect: (p: Property) => void;
}

const DOT_CLASS = {
  HOT:  "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.8)]",
  WARM: "bg-amber-400  shadow-[0_0_7px_rgba(251,191,36,0.8)]",
  COOL: "bg-rose-500",
};

const ROI_CLASS = {
  HOT:  "text-emerald-400",
  WARM: "text-amber-400",
  COOL: "text-slate-500",
};

const PILL_CLASS = {
  HOT:  "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25 shadow-[0_0_8px_rgba(52,211,153,0.2)]",
  WARM: "bg-amber-400/10  text-amber-400  border border-amber-400/25  shadow-[0_0_8px_rgba(251,191,36,0.2)]",
  COOL: "bg-rose-500/10   text-rose-400   border border-rose-500/25",
};

export default function NeighborhoodList({ properties, search, selected, onSelect }: Props) {
  const filtered = properties.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-slate-600 text-sm gap-2">
        <span className="text-2xl opacity-30">◇</span>
        <p className="text-xs">No matches</p>
      </div>
    );
  }

  return (
    <ul>
      {filtered.map((p) => {
        const b          = badge(p.roi_pct);
        const isSelected = selected?.id === p.id;

        return (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p)}
              className={`w-full text-left flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/40 transition-all duration-150 hover:bg-slate-800/20 ${
                isSelected
                  ? "bg-[#161B30] border-l-2 border-l-emerald-400 pl-[14px]"
                  : "border-l-2 border-l-transparent"
              }`}
            >
              {/* Neon status dot */}
              <div className={`w-2 h-2 rounded-full flex-none ${DOT_CLASS[b]}`} />

              {/* Name + price */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate leading-tight ${isSelected ? "text-slate-100" : "text-slate-300"}`}>
                  {p.name}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">{formatMoney(p.price)}</p>
              </div>

              {/* Sparkline */}
              <Sparkline roiPct={p.roi_pct} id={p.id} width={44} height={20} />

              {/* ROI + neon badge */}
              <div className="text-right flex-none w-14">
                <p className={`text-xs font-bold leading-tight ${ROI_CLASS[b]}`}>+{p.roi_pct.toFixed(1)}%</p>
                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest ${PILL_CLASS[b]}`}>
                  {b}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
