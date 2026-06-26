"use client";
import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Property } from "@/lib/api";
import { formatMoney, badge, BADGE_INFO, investmentScore } from "@/lib/api";
import type { EvaluationMarker } from "@/app/api/evaluate/route";
import AgentChat from "@/components/AgentChat";

const NeighborhoodEvaluator = dynamic(
  () => import("@/components/NeighborhoodEvaluator"),
  { ssr: false },
);

interface Props {
  selected: Property;
  onClose: () => void;
  onEvaluationComplete: (markers: EvaluationMarker[]) => void;
}

const BADGE_STYLE = {
  HOT:  "bg-emerald-400/15 border-emerald-400/30 text-emerald-400",
  WARM: "bg-amber-400/15 border-amber-400/30 text-amber-400",
  COOL: "bg-slate-700/40 border-slate-600/40 text-slate-400",
} as const;

export default function MobileBottomSheet({ selected, onClose, onEvaluationComplete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const touchStartY = useRef(0);

  const b     = badge(selected.roi_pct);
  const score = investmentScore(selected.roi_pct);

  // Reset when a different neighborhood is selected
  useEffect(() => {
    setExpanded(false);
    setShowAnalysis(false);
  }, [selected.id]);

  const onHandleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const onHandleTouchEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientY - touchStartY.current;
    if (delta < -60) {
      setExpanded(true);
    } else if (delta > 60) {
      if (expanded) setExpanded(false);
      else onClose();
    }
  };

  const handleAnalyze = () => {
    setShowAnalysis(true);
    setExpanded(true);
  };

  const handleEvaluatorClose = () => {
    setShowAnalysis(false);
    setExpanded(false);
  };

  return (
    <>
      {/* Dim backdrop when sheet is expanded */}
      {expanded && (
        <div
          className="md:hidden fixed inset-0 z-[2900] bg-black/40"
          onClick={() => { if (!showAnalysis) setExpanded(false); }}
        />
      )}

      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-[3000] flex flex-col bg-[#0F1322] border-t border-slate-800/60 rounded-t-3xl shadow-2xl"
        style={{
          height: expanded ? "85vh" : "226px",
          transition: "height 0.35s cubic-bezier(0.34, 1.2, 0.64, 1)",
        }}
      >
        {/* ── Drag handle ─────────────────────────────────────────────────────── */}
        <div
          className="flex-none flex justify-center pt-3 pb-2 touch-none cursor-grab select-none"
          onTouchStart={onHandleTouchStart}
          onTouchEnd={onHandleTouchEnd}
          onClick={() => { if (!showAnalysis) setExpanded(v => !v); }}
        >
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* ── Header: name + dismiss (hidden when evaluator is active) ───── */}
        {!showAnalysis && (
          <div className="flex-none flex items-start justify-between px-5 pb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-black text-slate-100 truncate leading-tight">
                {selected.name}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">Denver, CO</p>
            </div>
            <button
              onClick={onClose}
              className="ml-3 flex-none w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-100 flex items-center justify-center text-xs leading-none"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}

        {/* ── Compact info (hidden when analysis is running) ─────────────── */}
        {!showAnalysis && (
          <div className={`flex-none px-5 ${expanded ? "pb-2" : "pb-4"}`}>
            {/* Score ring + price/roi row */}
            <div className="flex items-center gap-4 mb-4">
              <ScoreRing score={score} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-[22px] font-black text-slate-100 leading-none">
                    {formatMoney(selected.price)}
                  </p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${BADGE_STYLE[b]}`}>
                    {BADGE_INFO[b].label}
                  </span>
                </div>
                <p className="text-sm font-bold text-emerald-400">
                  +{selected.roi_pct.toFixed(1)}% annual ROI
                </p>
                {selected.days_on_market != null && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {Math.round(selected.days_on_market)} days on market
                  </p>
                )}
              </div>
            </div>

            {/* CTA */}
            {selected.lat && selected.lng ? (
              <button
                onClick={handleAnalyze}
                className="w-full py-3.5 rounded-2xl text-[13px] font-black tracking-wide bg-gradient-to-r from-emerald-500 to-cyan-400 text-black shadow-lg shadow-emerald-900/40 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                <span>⚡</span> Deep Neighborhood Analysis
              </button>
            ) : (
              <p className="text-xs text-slate-500 text-center">
                No coordinates available for this neighborhood.
              </p>
            )}
          </div>
        )}

        {/* ── Agent chat when expanded (quick questions, no full analysis) ── */}
        {expanded && !showAnalysis && selected.lat && selected.lng && (
          <div className="flex-1 flex flex-col overflow-hidden border-t border-slate-800/40">
            <div className="flex-none flex items-center gap-2 px-5 py-2">
              <div className="flex-1 h-px bg-slate-800/40" />
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">
                💬 Ask the Agent
              </p>
              <div className="flex-1 h-px bg-slate-800/40" />
            </div>
            <div className="flex-1 overflow-hidden">
              <AgentChat neighborhood={selected.name} lat={selected.lat} lng={selected.lng} />
            </div>
          </div>
        )}

        {/* ── Full analysis view ──────────────────────────────────────────── */}
        {showAnalysis && selected.lat && selected.lng && (
          <div className="flex-1 overflow-hidden">
            <NeighborhoodEvaluator
              neighborhood={selected.name}
              lat={selected.lat}
              lng={selected.lng}
              onClose={handleEvaluatorClose}
              onEvaluationComplete={onEvaluationComplete}
            />
          </div>
        )}
      </div>
    </>
  );
}

function ScoreRing({ score }: { score: number }) {
  const SIZE = 60;
  const R    = (SIZE - 8) / 2;
  const CIRC = 2 * Math.PI * R;
  const pct  = score / 100;
  const color =
    pct >= 0.7  ? "#34d399" :
    pct >= 0.5  ? "#22d3ee" :
    pct >= 0.35 ? "#f59e0b" :
    "#f43f5e";
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  return (
    <svg
      width={SIZE}
      height={SIZE}
      style={{ transform: "rotate(-90deg)", flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#1e293b" strokeWidth={7} />
      <circle
        cx={cx} cy={cy} r={R} fill="none" stroke={color} strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${CIRC * pct} ${CIRC * (1 - pct)}`}
      />
      <text
        x={cx} y={cy + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={13}
        fontWeight={900}
        style={{ transform: `rotate(90deg)`, transformOrigin: `${cx}px ${cy}px` }}
      >
        {score}
      </text>
    </svg>
  );
}
