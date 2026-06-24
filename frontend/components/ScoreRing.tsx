"use client";

interface Props {
  score: number; // 0–100
}

export default function ScoreRing({ score }: Props) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;

  const color =
    score >= 80 ? "#29b86b" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#0a2218" strokeWidth="10" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x="55" y="55" textAnchor="middle" dy="0.35em" fontSize="22" fontWeight="700" fill={color}>
          {score}
        </text>
      </svg>
      <span className="text-xs text-forest-500 tracking-widest uppercase">Investment Score</span>
    </div>
  );
}
