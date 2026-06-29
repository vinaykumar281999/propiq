"use client";
import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type HistoryItem = { role: "user" | "assistant"; content: string };

interface ModelResponse {
  text: string;
  tools: string[];
  loading: boolean;
  ms: number | null;
  isError?: boolean;
}

interface Turn {
  id: number;
  question: string;
  llama: ModelResponse;
  qwen: ModelResponse;
}

interface Props {
  neighborhood: string;
  lat: number | null;
  lng: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Good for families?",
  "Monthly mortgage on $500K?",
  "What makes this special?",
  "Compare to Cherry Creek",
  "What are the risks?",
];

const TOOL_LABEL: Record<string, string> = {
  get_price_data:          "price data",
  get_schools_nearby:      "schools",
  get_hospitals_nearby:    "healthcare",
  get_lifestyle_amenities: "amenities",
  get_premium_factors:     "premium factors",
  calculate_mortgage:      "mortgage",
  compare_neighborhoods:   "comparison",
};

const EMPTY_RESPONSE: ModelResponse = { text: "", tools: [], loading: true, ms: null };

// ── Helpers ───────────────────────────────────────────────────────────────────

function historyFromTurns(turns: Turn[], side: "llama" | "qwen"): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const t of turns) {
    const r = t[side];
    if (r.loading || !r.text) continue;
    items.push({ role: "user",      content: t.question });
    items.push({ role: "assistant", content: r.text });
  }
  return items.slice(-20);
}

async function fetchModel(
  question: string,
  modelId: string,
  history: HistoryItem[],
  neighborhood: string,
  lat: number | null,
  lng: number | null,
): Promise<{ answer: string; tools_called: string[]; ms: number; isError?: boolean }> {
  const t0 = Date.now();
  const label = modelId.toLowerCase().includes("qwen") ? "Qwen" : "Llama";
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, neighborhood, lat, lng, model: modelId, history }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json() as { answer?: string; error?: string; tools_called?: string[] };
    const answer = data.answer || data.error || "";
    if (!answer) {
      return { answer: `${label} timed out — try again`, tools_called: [], ms: Date.now() - t0, isError: true };
    }
    return { answer, tools_called: data.tools_called ?? [], ms: Date.now() - t0 };
  } catch (e) {
    const ms = Date.now() - t0;
    const isTimeout = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
    return {
      answer:      isTimeout ? `${label} timed out — try again` : `Error: ${e instanceof Error ? e.message : e}`,
      tools_called: [],
      ms,
      isError:     true,
    };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Dots() {
  return (
    <div className="flex gap-1 items-center py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-slate-500 inline-block animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function ToolPills({ tools }: { tools: string[] }) {
  if (!tools.length) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mb-1">
      {tools.map((t) => (
        <span
          key={t}
          className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-violet-900/30 border border-violet-700/40 text-violet-300 leading-none"
        >
          🔧 {TOOL_LABEL[t] ?? t.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function ResponseCell({ r }: { r: ModelResponse }) {
  return (
    <div className={`rounded-xl p-2.5 min-h-[48px] border ${r.isError ? "bg-red-950/30 border-red-800/40" : "bg-slate-800/70 border-slate-700/50"}`}>
      {r.loading ? (
        <Dots />
      ) : (
        <>
          <ToolPills tools={r.tools} />
          <p className={`text-[11px] leading-relaxed whitespace-pre-wrap break-words ${r.isError ? "text-red-400" : "text-slate-200"}`}>
            {r.text}
          </p>
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentChat({ neighborhood, lat, lng }: Props) {
  const [turns, setTurns]     = useState<Turn[]>([]);
  const [input, setInput]     = useState("");
  const [isRemote, setIsRemote] = useState(false);
  const inputRef              = useRef<HTMLInputElement>(null);
  const bottomRef             = useRef<HTMLDivElement>(null);

  // Detect Vercel / remote deployment — Ollama is only reachable on localhost
  useEffect(() => {
    const host = window.location.hostname;
    setIsRemote(host !== "localhost" && host !== "127.0.0.1");
  }, []);

  const loading = turns.some((t) => t.llama.loading || t.qwen.loading);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    setTurns([]);
    setInput("");
  }, [neighborhood]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;

    const id = Date.now();
    setTurns((prev) => [
      ...prev,
      { id, question, llama: { ...EMPTY_RESPONSE }, qwen: { ...EMPTY_RESPONSE } },
    ]);
    setInput("");

    const llamaHistory = historyFromTurns(turns, "llama");
    const qwenHistory  = historyFromTurns(turns, "qwen");

    const update = (side: "llama" | "qwen", patch: Partial<ModelResponse>) =>
      setTurns((prev) =>
        prev.map((t) => t.id === id ? { ...t, [side]: { ...t[side], ...patch } } : t),
      );

    await Promise.allSettled([
      fetchModel(question, "llama3.2",   llamaHistory, neighborhood, lat, lng)
        .then((r) => update("llama", { text: r.answer, tools: r.tools_called, loading: false, ms: r.ms, isError: r.isError }))
        .catch((e) => update("llama", { text: `Error: ${e instanceof Error ? e.message : e}`, tools: [], loading: false, ms: null, isError: true })),

      fetchModel(question, "qwen3.5",    qwenHistory,  neighborhood, lat, lng)
        .then((r) => update("qwen",  { text: r.answer, tools: r.tools_called, loading: false, ms: r.ms, isError: r.isError }))
        .catch((e) => update("qwen",  { text: `Error: ${e instanceof Error ? e.message : e}`, tools: [], loading: false, ms: null, isError: true })),
    ]);

    inputRef.current?.focus();
  };

  const lastTurn = turns.at(-1);

  // On Vercel / remote deployments, Ollama isn't reachable — show a static notice
  if (isRemote) {
    return (
      <div className="flex flex-col h-full items-center justify-center px-5 py-6 text-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-xl">
          💡
        </div>
        <div className="space-y-1">
          <p className="text-[12px] font-bold text-slate-200">
            AI Agent — local mode only
          </p>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-[260px]">
            Running on your Mac with Ollama, this chat lets you ask questions about any neighborhood in real time.
          </p>
        </div>
        <div className="mt-1 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-left max-w-[260px]">
          <p className="text-[10px] font-semibold text-slate-400 mb-1">To enable locally:</p>
          <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
            ollama serve<br />
            npm run dev
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Model header tabs ───────────────────────────────────────────────── */}
      <div className="flex-none grid grid-cols-2 border-b border-slate-800/60 bg-slate-900/50">
        {(
          [
            { key: "llama" as const, label: "Llama 3.2",  color: "text-orange-400",  border: "border-orange-500/40" },
            { key: "qwen"  as const, label: "Qwen 3.5",   color: "text-cyan-400",    border: "border-cyan-500/40"   },
          ] as const
        ).map(({ key, label, color, border }) => {
          const r = lastTurn?.[key];
          return (
            <div
              key={key}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 ${border} first:border-r first:border-r-slate-800/60`}
            >
              <span className={`text-[10px] font-black uppercase tracking-wide ${color}`}>
                {label}
              </span>
              {r?.loading && (
                <span className="flex gap-0.5">
                  {[0,1,2].map((i) => (
                    <span key={i} className="w-1 h-1 rounded-full bg-slate-500 inline-block animate-bounce" style={{ animationDelay: `${i * 0.12}s` }} />
                  ))}
                </span>
              )}
              {!r?.loading && r?.ms != null && (
                <span className="text-[9px] text-slate-500 ml-auto">
                  ⏱ {(r.ms / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Suggestion chips (empty state) ─────────────────────────────────── */}
      {turns.length === 0 && (
        <div className="flex-none px-3 pt-2.5 pb-1">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-[10px] font-semibold px-2.5 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300 active:scale-95 transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Conversation turns ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-1.5">
            {/* User question — full width */}
            <div className="flex justify-end">
              <div className="max-w-[90%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-[11px] leading-relaxed shadow-md shadow-indigo-900/40">
                {turn.question}
              </div>
            </div>

            {/* Model responses — two columns */}
            <div className="grid grid-cols-2 gap-1.5">
              <ResponseCell r={turn.llama} />
              <ResponseCell r={turn.qwen} />
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input row ──────────────────────────────────────────────────────── */}
      <div className="flex-none px-3 pb-3 pt-2 border-t border-slate-800/60">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask both models…"
            disabled={loading}
            className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700/60 text-slate-100 text-[12px] rounded-xl px-3 py-2.5 placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            aria-label="Send to both models"
            className="flex-none w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-400 text-black flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

    </div>
  );
}
