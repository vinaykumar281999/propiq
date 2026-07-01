"use client";
import type { Property } from "@/lib/api";

function classify(monthsOfSupply: number): {
  label: string; text: string; bg: string; border: string; blurb: string;
} {
  if (monthsOfSupply < 2) {
    return {
      label: "Hot market", text: "text-red-400", bg: "bg-red-950/40", border: "border-red-800/50",
      blurb: "Hot market — low inventory. Expect competition and less negotiating room.",
    };
  }
  if (monthsOfSupply <= 4) {
    return {
      label: "Balanced", text: "text-amber-400", bg: "bg-amber-950/40", border: "border-amber-800/50",
      blurb: "Balanced market — supply and demand are roughly in equilibrium.",
    };
  }
  return {
    label: "Buyer's market", text: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-800/50",
    blurb: "Buyer's market — high inventory gives buyers more negotiating leverage.",
  };
}

export default function InventoryVelocityCard({ property }: { property: Property }) {
  const hasData = property.months_of_supply != null;
  const months = hasData ? Math.round((property.months_of_supply as number) * 10) / 10 : 0;
  const { label, text, bg, border, blurb } = classify(months);

  return (
    <div className="border-t border-slate-800/60 px-4 pt-3 pb-4 bg-[#0F1322]/80">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Inventory Velocity</p>
      {hasData ? (
        <div className={`rounded-xl p-3 border ${bg} ${border}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-300 leading-snug">
              <span className="text-lg font-black text-slate-100">{months}</span> months of supply
            </p>
            <span className={`flex-none text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${text} ${bg} ${border}`}>
              {label}
            </span>
          </div>
          <p className="text-[9px] text-slate-500 mt-1.5">{blurb}</p>
        </div>
      ) : (
        <div className="rounded-xl p-3 border bg-[#161B30] border-slate-700/60">
          <p className="text-[10px] text-slate-500">Inventory data isn't available for this neighborhood yet.</p>
        </div>
      )}
    </div>
  );
}
