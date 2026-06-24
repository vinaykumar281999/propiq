"use client";

interface Point { month: number; value: number }

function fmtLabel(month: number): string {
  if (month % 12 === 0) return `Y${month / 12}`;
  return `M${month}`;
}

export default function ProjectionChart({ points, totalMonths = 6 }: { points: Point[]; totalMonths?: number }) {
  void totalMonths; // available for future use
  const max = Math.max(...points.map((p) => p.value), 1);
  const w = 360;
  const h = 120;
  const pad = { top: 12, right: 12, bottom: 28, left: 52 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const xs = points.map((_, i) => pad.left + (i / (points.length - 1)) * innerW);
  const ys = points.map((p) => pad.top + (1 - p.value / max) * innerH);

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const area = [
    `${xs[0]},${pad.top + innerH}`,
    ...xs.map((x, i) => `${x},${ys[i]}`),
    `${xs[xs.length - 1]},${pad.top + innerH}`,
  ].join(" ");

  const fmt = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {[0, 0.5, 1].map((f) => {
        const y = pad.top + (1 - f) * innerH;
        return (
          <g key={f}>
            <line x1={pad.left} y1={y} x2={pad.left + innerW} y2={y} stroke="#1e1e2e" strokeWidth="1" />
            <text x={pad.left - 4} y={y} textAnchor="end" fontSize="9" fill="#4b5563" dy="0.35em">
              {fmt(Math.round(max * f))}
            </text>
          </g>
        );
      })}

      <polygon points={area} fill="url(#areaGrad)" />
      <polyline points={polyline} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" />

      {xs.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={ys[i]} r={3} fill="#6366f1" />
          <text x={x} y={pad.top + innerH + 14} textAnchor="middle" fontSize="9" fill="#4b5563">
            {fmtLabel(points[i].month)}
          </text>
        </g>
      ))}
    </svg>
  );
}
