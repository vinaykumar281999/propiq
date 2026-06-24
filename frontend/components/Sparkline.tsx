"use client";

interface Props {
  roiPct: number;
  id: number;
  width?: number;
  height?: number;
}

function seededNoise(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297 + 233) * 10000;
  return x - Math.floor(x);
}

function generatePoints(roiPct: number, id: number, count = 7): number[] {
  const endPct   = roiPct >= 8 ? 0.90 : roiPct >= 4 ? 0.68 : 0.46;
  const startPct = roiPct >= 8 ? 0.22 : roiPct >= 4 ? 0.30 : 0.36;

  return Array.from({ length: count }, (_, i) => {
    const trend = startPct + (endPct - startPct) * (i / (count - 1));
    const noise = (seededNoise(id, i) - 0.5) * 0.18;
    return Math.max(0.04, Math.min(0.96, trend + noise));
  });
}

export default function Sparkline({ roiPct, id, width = 48, height = 24 }: Props) {
  const pts   = generatePoints(roiPct, id);
  const stepX = width / (pts.length - 1);
  const xs    = pts.map((_, i) => i * stepX);
  const ys    = pts.map((v) => height - v * (height - 2) - 1);
  const d     = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const color = roiPct >= 8 ? "#34d399" : roiPct >= 4 ? "#fbbf24" : "#f43f5e";
  const endX  = xs[xs.length - 1].toFixed(1);
  const endY  = ys[ys.length - 1].toFixed(1);

  return (
    <svg width={width} height={height} className="flex-none overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <circle cx={endX} cy={endY} r="1.8" fill={color} opacity="0.95" />
    </svg>
  );
}
