"use client";

import { useEffect, useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { NeighborhoodEvaluation, EvaluationMarker } from "@/app/api/evaluate/route";
import AgentChat from "@/components/AgentChat";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  neighborhood: string;
  lat: number;
  lng: number;
  onClose: () => void;
  onEvaluationComplete?: (markers: EvaluationMarker[]) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number, max: number) {
  const pct = score / max;
  if (pct >= 0.8) return "#34d399"; // emerald
  if (pct >= 0.5) return "#f59e0b"; // amber
  return "#f43f5e";                  // red
}

function verdictConfig(v: string) {
  if (v === "STRONG BUY") return { bg: "from-emerald-500/20 to-cyan-500/10", border: "border-emerald-500/40", text: "text-emerald-400" };
  if (v === "BUY")        return { bg: "from-emerald-500/15 to-teal-500/10", border: "border-emerald-500/30", text: "text-emerald-400" };
  if (v === "HOLD")       return { bg: "from-amber-500/15 to-yellow-500/10", border: "border-amber-500/30",   text: "text-amber-400" };
  return                           { bg: "from-red-500/15 to-rose-500/10",   border: "border-red-500/30",     text: "text-red-400" };
}

function dimLabel(key: string) {
  return (
    key === "price_momentum"  ? "Price Momentum"      :
    key === "school_proximity" ? "School Proximity"    :
    key === "healthcare"      ? "Healthcare Access"   :
    key === "lifestyle"       ? "Lifestyle & Amenities" :
    "Premium Factors"
  );
}

function dimIcon(key: string) {
  return (
    key === "price_momentum"  ? "📈" :
    key === "school_proximity" ? "🏫" :
    key === "healthcare"      ? "🏥" :
    key === "lifestyle"       ? "🏖️" :
    "⭐"
  );
}

// ── Score ring (mini SVG) ─────────────────────────────────────────────────────

function ScoreRing({ score, max = 100, size = 72 }: { score: number; max?: number; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = score / max;
  const color =
    pct >= 0.8 ? "#34d399" : pct >= 0.65 ? "#22d3ee" : pct >= 0.45 ? "#f59e0b" : "#f43f5e";

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={8} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text
        x={size / 2} y={size / 2 + 1}
        textAnchor="middle" dominantBaseline="middle"
        style={{ transform: "rotate(90deg)", transformOrigin: `${size / 2}px ${size / 2}px` }}
        fill={color} fontSize={size < 60 ? 11 : 16} fontWeight={900}
      >
        {score}
      </text>
    </svg>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="h-20 bg-slate-800/60 rounded-2xl" />
      <div className="h-52 bg-slate-800/60 rounded-2xl" />
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-16 bg-slate-800/60 rounded-xl" />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NeighborhoodEvaluator({
  neighborhood, lat, lng, onClose, onEvaluationComplete,
}: Props) {
  const [loading, setLoading]     = useState(true);
  const [evaluation, setEvaluation] = useState<NeighborhoodEvaluation | null>(null);
  const [error, setError]         = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    setEvaluation(null);

    fetch(
      `/api/evaluate?neighborhood=${encodeURIComponent(neighborhood)}&lat=${lat}&lng=${lng}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data: NeighborhoodEvaluation) => {
        setEvaluation(data);
        onEvaluationComplete?.(data.evaluation_markers ?? []);
      })
      .catch(() => setError("Failed to load neighborhood analysis. Please try again."))
      .finally(() => setLoading(false));
  }, [neighborhood, lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const GLASS = "backdrop-blur-md bg-slate-900/90 border border-slate-800/80";

  // ── Radar chart data ───────────────────────────────────────────────────────
  const radarData = evaluation
    ? [
        {
          dim: "Price",
          score: evaluation.dimensions.price_momentum.score,
          max: 25,
          pct: Math.round((evaluation.dimensions.price_momentum.score / 25) * 100),
        },
        {
          dim: "Schools",
          score: evaluation.dimensions.school_proximity.score,
          max: 20,
          pct: Math.round((evaluation.dimensions.school_proximity.score / 20) * 100),
        },
        {
          dim: "Health",
          score: evaluation.dimensions.healthcare.score,
          max: 15,
          pct: Math.round((evaluation.dimensions.healthcare.score / 15) * 100),
        },
        {
          dim: "Lifestyle",
          score: evaluation.dimensions.lifestyle.score,
          max: 20,
          pct: Math.round((evaluation.dimensions.lifestyle.score / 20) * 100),
        },
        {
          dim: "Premium",
          score: evaluation.dimensions.premium_factors.score,
          max: 20,
          pct: Math.round((evaluation.dimensions.premium_factors.score / 20) * 100),
        },
      ]
    : [];

  const vc = evaluation ? verdictConfig(evaluation.verdict) : null;

  return (
    <div className={`h-full flex flex-col ${GLASS} shadow-2xl shadow-black/60`}>
      {/* Header */}
      <div className="flex-none px-4 pt-4 pb-3 border-b border-slate-800/60">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">
              Neighborhood Analysis
            </p>
            <p className="text-sm font-bold text-slate-100 leading-tight truncate">
              {neighborhood}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {lat.toFixed(4)}, {lng.toFixed(4)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-none w-7 h-7 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 flex items-center justify-center text-xs transition-all"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 text-slate-400">
              <div className="w-4 h-4 border-2 border-slate-700 border-t-emerald-400 rounded-full animate-spin flex-none" />
              <p className="text-xs">Running neighborhood analysis…</p>
            </div>
            <Skeleton />
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3">
              <p className="text-xs text-red-400">{error}</p>
              <button
                onClick={() => {
                  setError("");
                  setLoading(true);
                  fetch(`/api/evaluate?neighborhood=${encodeURIComponent(neighborhood)}&lat=${lat}&lng=${lng}`)
                    .then((r) => r.json())
                    .then((data) => { setEvaluation(data); onEvaluationComplete?.(data.evaluation_markers ?? []); })
                    .catch(() => setError("Still failing. Check your API key."))
                    .finally(() => setLoading(false));
                }}
                className="mt-2 text-[10px] text-red-400 border border-red-800/50 rounded-lg px-2.5 py-1 hover:bg-red-900/30 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        ) : evaluation && vc ? (
          <div className="p-4 space-y-4">

            {/* Score + Verdict hero */}
            <div className={`rounded-2xl p-4 bg-gradient-to-br ${vc.bg} border ${vc.border}`}>
              <div className="flex items-center gap-4">
                <ScoreRing score={evaluation.total_score} />
                <div className="min-w-0">
                  <p className={`text-2xl font-black leading-none ${vc.text}`}>
                    {evaluation.verdict}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {evaluation.total_score}/100 overall score
                  </p>
                  <div className="mt-2 h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${evaluation.total_score}%`,
                        background: "linear-gradient(90deg, #34d399, #22d3ee)",
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Agent summary */}
              {evaluation.agent_summary && (
                <p className="mt-3 text-[11px] text-slate-300 leading-relaxed border-t border-slate-700/40 pt-3">
                  {evaluation.agent_summary}
                </p>
              )}
            </div>

            {/* Radar chart */}
            <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-3">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">
                Investment Radar
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                  <PolarGrid stroke="#1e293b" />
                  <PolarAngleAxis
                    dataKey="dim"
                    tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 600 }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 100]}
                    tick={{ fill: "#475569", fontSize: 8 }}
                    tickCount={4}
                  />
                  <Radar
                    name="Score %"
                    dataKey="pct"
                    stroke="#34d399"
                    fill="#34d399"
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0f1322",
                      border: "1px solid #1e293b",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(val, _name, props) =>
                      [`${props.payload.score}/${props.payload.max} pts (${val}%)`, "Score"]
                    }
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Dimension breakdown */}
            <div className="space-y-2.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                Dimension Breakdown
              </p>

              {(
                [
                  ["price_momentum",  evaluation.dimensions.price_momentum],
                  ["school_proximity", evaluation.dimensions.school_proximity],
                  ["healthcare",      evaluation.dimensions.healthcare],
                  ["lifestyle",       evaluation.dimensions.lifestyle],
                  ["premium_factors", evaluation.dimensions.premium_factors],
                ] as const
              ).map(([key, dim]) => {
                const color = scoreColor(dim.score, dim.max);
                const barPct = Math.round((dim.score / dim.max) * 100);

                return (
                  <div
                    key={key}
                    className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3"
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{dimIcon(key)}</span>
                        <span className="text-[11px] font-bold text-slate-200">{dimLabel(key)}</span>
                      </div>
                      <span
                        className="text-[11px] font-black"
                        style={{ color }}
                      >
                        {dim.score}/{dim.max}
                      </span>
                    </div>

                    {/* Score bar */}
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2.5">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${barPct}%`,
                          background: color,
                          boxShadow: `0 0 6px ${color}55`,
                        }}
                      />
                    </div>

                    {/* Reasoning */}
                    {dim.reasoning && (
                      <p className="text-[10px] text-slate-400 leading-relaxed mb-2">
                        {dim.reasoning}
                      </p>
                    )}

                    {/* Trend / extra meta for price */}
                    {key === "price_momentum" && dim.trend && (
                      <span className="inline-block text-[9px] font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/25 rounded-full px-2 py-0.5">
                        {dim.trend}
                      </span>
                    )}

                    {/* Locations list */}
                    {dim.locations && dim.locations.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {dim.locations.slice(0, 4).map((loc, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-slate-400 truncate">{loc.name}</span>
                            <span className="text-[9px] text-slate-500 flex-none">
                              {loc.distance_km}km
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Value drivers */}
            {(() => {
              const OSM_JUNK = new Set(["way", "node", "relation", "", "unknown"]);
              const drivers = evaluation.value_drivers_identified.filter(
                (d) => d && !OSM_JUNK.has(d.trim().toLowerCase()),
              );
              return drivers.length > 0 ? (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Value Drivers
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {drivers.map((d, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/25 rounded-full px-2.5 py-1"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Risk factors */}
            {(() => {
              const OSM_JUNK = new Set(["way", "node", "relation", "", "unknown"]);
              const risks = evaluation.risk_factors.filter(
                (r) => r && !OSM_JUNK.has(r.trim().toLowerCase()),
              );
              return risks.length > 0 ? (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                    Risk Factors
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {risks.map((r, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-semibold bg-amber-400/10 text-amber-400 border border-amber-400/25 rounded-full px-2.5 py-1"
                      >
                        ⚠ {r}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Footer */}
            <p className="text-[9px] text-slate-600 pb-2">
              Powered by PropIQ Agent + Claude · OpenStreetMap Overpass API · Redfin data Jan–May 2026
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Agent Chat ─────────────────────────────────────────────────────── */}
      {!loading && !error && evaluation && (
        <>
          <div className="flex-none flex items-center gap-2 px-4 py-2 border-t border-slate-800/60">
            <div className="flex-1 h-px bg-slate-800/40" />
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
              💬 Ask the Agent
            </p>
            <div className="flex-1 h-px bg-slate-800/40" />
          </div>
          <div className="flex-none h-72">
            <AgentChat neighborhood={neighborhood} lat={lat} lng={lng} />
          </div>
        </>
      )}
    </div>
  );
}
