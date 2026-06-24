"use client";
import { Property, badge, formatMoney, BADGE_INFO } from "@/lib/api";

interface Props {
  properties: Property[];
  search: string;
  selected: Property | null;
  onSelect: (p: Property) => void;
}

const borderColor = {
  HOT:  "border-orange-500",
  WARM: "border-blue-500",
  COOL: "border-gray-600",
};

function TrendArrow({ roi }: { roi: number }) {
  if (roi >= 10) return <span className="text-emerald-400 font-bold text-sm leading-none">↑↑</span>;
  if (roi >= 4)  return <span className="text-emerald-600 text-sm leading-none">↑</span>;
  return <span className="text-gray-600 text-sm leading-none">→</span>;
}

export default function NeighborhoodList({ properties, search, selected, onSelect }: Props) {
  const filtered = properties.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-600 text-sm">
        <span className="text-3xl mb-2">🔍</span>
        <p>No matches for &ldquo;{search}&rdquo;</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-navy-800/60">
      {filtered.map((p) => {
        const b = badge(p.roi_pct);
        const isSelected = selected?.id === p.id;
        const sixMonthEarn = formatMoney(p.expected_return / 2);

        return (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p)}
              title={`${BADGE_INFO[b].label} — ${BADGE_INFO[b].subtitle}`}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-navy-800/50 border-l-2 ${
                isSelected
                  ? `bg-navy-800/80 ${borderColor[b]}`
                  : `${borderColor[b]} opacity-50 hover:opacity-100`
              }`}
            >
              <TrendArrow roi={p.roi_pct} />

              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold truncate ${isSelected ? "text-white" : "text-gray-300"}`}>
                  {p.name}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">{formatMoney(p.price)}</p>
              </div>

              <div className="text-right flex-none">
                <p className="text-xs font-bold text-emerald-400">{sixMonthEarn}</p>
                <p className="text-[10px] text-gray-700">6 mo</p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
