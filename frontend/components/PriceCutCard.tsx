"use client";
import type { Property } from "@/lib/api";

function classify(pct: number): {
  label: string; text: string; bg: string; border: string; blurb: string;
} {
  if (pct >= 30) {
    return {
      label: "High cuts", text: "text-red-400", bg: "bg-red-950/40", border: "border-red-800/50",
      blurb: "Elevated price cuts signal a cooling market — buyers may have negotiating leverage.",
    };
  }
  if (pct >= 15) {
    return {
      label: "Normal", text: "text-amber-400", bg: "bg-amber-950/40", border: "border-amber-800/50",
      blurb: "Price cuts are in a typical range for this market.",
    };
  }
  return {
    label: "Few cuts", text: "text-emerald-400", bg: "bg-emerald-950/40", border: "border-emerald-800/50",
    blurb: "Few price cuts — sellers are holding firm, a sign of a competitive market.",
  };
}

export default function PriceCutCard({ property }: { property: Property }) {
  const hasData = property.price_drops != null;
  const pct = hasData ? Math.round((property.price_drops as number) * 1000) / 10 : 0;
  const { label, text, bg, border, blurb } = classify(pct);

  return (
    <div className="border-t border-slate-800/60 px-4 pt-3 pb-4 bg-[#0F1322]/80">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Price Cut Tracker</p>
      {hasData ? (
        <div className={`rounded-xl p-3 border ${bg} ${border}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-300 leading-snug">
              <span className="text-lg font-black text-slate-100">{pct}%</span> of homes have had price reductions
            </p>
            <span className={`flex-none text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border ${text} ${bg} ${border}`}>
              {label}
            </span>
          </div>
          <p className="text-[9px] text-slate-500 mt-1.5">{blurb}</p>
        </div>
      ) : (
        <div className="rounded-xl p-3 border bg-[#161B30] border-slate-700/60">
          <p className="text-[10px] text-slate-500">Price cut data isn't available for this neighborhood yet.</p>
        </div>
      )}
    </div>
  );
}
