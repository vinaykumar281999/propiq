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
  statusText?: string;
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

// When true, left tab sends requests to Groq (cloud); right tab uses Ollama (local)
const USE_GROQ = process.env.NEXT_PUBLIC_USE_GROQ === "true";

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
const IDLE_RESPONSE:  ModelResponse = { text: "", tools: [], loading: false, ms: null };

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

// modelId undefined → let backend choose (Claude on Vercel, Ollama locally via env)
async function fetchModel(
  question: string,
  modelId: string | undefined,
  history: HistoryItem[],
  neighborhood: string,
  lat: number | null,
  lng: number | null,
  timeoutMs = 60000,
): Promise<{ answer: string; tools_called: string[]; ms: number; isError?: boolean }> {
  const t0 = Date.now();
  const label = !modelId ? "AI Agent"
    : modelId.toLowerCase().includes("qwen") ? "Qwen"
    : "Llama";

  const payload: Record<string, unknown> = {
    message: question, neighborhood, lat, lng, history,
  };
  if (modelId) payload.model = modelId;

  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
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
      answer:       isTimeout ? `${label} timed out — try again` : `Error: ${e instanceof Error ? e.message : e}`,
      tools_called: [],
      ms,
      isError:      true,
    };
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Dots({ label }: { label?: string }) {
  return (
    <div className="flex gap-1.5 items-center py-1">
      {label && <span className="text-[11px] text-slate-400 italic">{label}</span>}
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-slate-500 inline-block animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
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
        r.statusText
          ? <p className="text-[11px] text-slate-400 italic">{r.statusText}</p>
          : <Dots label="AI Agent is thinking…" />
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

function TimingBadge({ r }: { r: ModelResponse | undefined }) {
  if (!r || r.loading) {
    return r?.loading ? (
      <span className="flex gap-0.5 ml-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1 h-1 rounded-full bg-slate-500 inline-block animate-bounce" style={{ animationDelay: `${i * 0.12}s` }} />
        ))}
      </span>
    ) : null;
  }
  if (r.ms != null) {
    return <span className="text-[9px] text-slate-500 ml-auto">⏱ {(r.ms / 1000).toFixed(1)}s</span>;
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AgentChat({ neighborhood, lat, lng }: Props) {
  const [turns, setTurns]       = useState<Turn[]>([]);
  const [input, setInput]       = useState("");
  const [isRemote, setIsRemote] = useState(false);
  const inputRef                = useRef<HTMLInputElement>(null);
  const bottomRef               = useRef<HTMLDivElement>(null);

  // Detect Vercel / remote: Ollama only runs on localhost, Claude runs anywhere
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

  const update = (id: number, side: "llama" | "qwen", patch: Partial<ModelResponse>) =>
    setTurns((prev) =>
      prev.map((t) => t.id === id ? { ...t, [side]: { ...t[side], ...patch } } : t),
    );

  // Remote (Vercel): single Claude request stored in the llama slot
  const sendRemote = async (question: string) => {
    const id = Date.now();
    setTurns((prev) => [...prev, { id, question, llama: { ...EMPTY_RESPONSE }, qwen: { ...IDLE_RESPONSE } }]);
    setInput("");
    const history = historyFromTurns(turns, "llama");
    fetchModel(question, undefined, history, neighborhood, lat, lng)
      .then((r) => update(id, "llama", { text: r.answer, tools: r.tools_called, loading: false, ms: r.ms, isError: r.isError }))
      .catch((e) => update(id, "llama", { text: `Error: ${e instanceof Error ? e.message : e}`, tools: [], loading: false, ms: null, isError: true }))
      .finally(() => inputRef.current?.focus());
  };

  // Local: parallel Llama + Qwen requests
  const sendLocal = async (question: string) => {
    const id = Date.now();
    setTurns((prev) => [...prev, { id, question, llama: { ...EMPTY_RESPONSE }, qwen: { ...EMPTY_RESPONSE } }]);
    setInput("");
    const llamaHistory = historyFromTurns(turns, "llama");
    const qwenHistory  = historyFromTurns(turns, "qwen");

    // After 30s, show "Still thinking…" in the Qwen cell while it keeps waiting
    const qwenSlowTimer = setTimeout(() => {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id && t.qwen.loading
            ? { ...t, qwen: { ...t.qwen, statusText: "⏳ Still thinking…" } }
            : t,
        ),
      );
    }, 30000);

    await Promise.allSettled([
      // Left tab: no model override when USE_GROQ (backend picks Groq); "llama3.2" otherwise
      fetchModel(question, USE_GROQ ? undefined : "llama3.2", llamaHistory, neighborhood, lat, lng)
        .then((r) => update(id, "llama", { text: r.answer, tools: r.tools_called, loading: false, ms: r.ms, isError: r.isError }))
        .catch((e) => update(id, "llama", { text: `Error: ${e instanceof Error ? e.message : e}`, tools: [], loading: false, ms: null, isError: true })),
      // Right tab: always Ollama (llama3.2), 90s timeout for larger local model
      fetchModel(question, "llama3.2", qwenHistory, neighborhood, lat, lng, 90000)
        .then((r) => { clearTimeout(qwenSlowTimer); update(id, "qwen", { text: r.answer, tools: r.tools_called, loading: false, ms: r.ms, isError: r.isError, statusText: undefined }); })
        .catch((e) => { clearTimeout(qwenSlowTimer); update(id, "qwen", { text: `Error: ${e instanceof Error ? e.message : e}`, tools: [], loading: false, ms: null, isError: true, statusText: undefined }); }),
    ]);
    inputRef.current?.focus();
  };

  const send = (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    if (isRemote) sendRemote(question);
    else           sendLocal(question);
  };

  const lastTurn = turns.at(-1);

  return (
    <div className="flex flex-col h-full">

      {/* ── Model header ───────────────────────────────────────────────────── */}
      {isRemote ? (
        // Single AI Agent tab (backend picks Claude / Groq / Ollama server-side)
        <div className="flex-none flex items-center gap-1.5 px-3 py-2 border-b-2 border-violet-500/40 border-b border-slate-800/60 bg-slate-900/50">
          <span className="text-[10px] font-black uppercase tracking-wide text-violet-400">AI Agent</span>
          <TimingBadge r={lastTurn?.llama} />
        </div>
      ) : (
        // Dual tabs: Groq (Cloud) + Ollama (Local) when USE_GROQ, else Llama + Qwen
        <div className="flex-none grid grid-cols-2 border-b border-slate-800/60 bg-slate-900/50">
          {(USE_GROQ
            ? [
                { key: "llama" as const, label: "Groq (Cloud)",   color: "text-green-400",  border: "border-green-500/40"  },
                { key: "qwen"  as const, label: "Ollama (Local)",  color: "text-orange-400", border: "border-orange-500/40" },
              ]
            : [
                { key: "llama" as const, label: "Llama 3.2",      color: "text-orange-400", border: "border-orange-500/40" },
                { key: "qwen"  as const, label: "Qwen 3.5",       color: "text-cyan-400",   border: "border-cyan-500/40"   },
              ]
          ).map(({ key, label, color, border }) => (
            <div
              key={key}
              className={`flex items-center gap-1.5 px-3 py-2 border-b-2 ${border} first:border-r first:border-r-slate-800/60`}
            >
              <span className={`text-[10px] font-black uppercase tracking-wide ${color}`}>{label}</span>
              <TimingBadge r={lastTurn?.[key]} />
            </div>
          ))}
        </div>
      )}

      {/* ── Suggestion chips ───────────────────────────────────────────────── */}
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

      {/* ── Conversation turns ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-1.5">
            <div className="flex justify-end">
              <div className="max-w-[90%] bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 text-[11px] leading-relaxed shadow-md shadow-indigo-900/40">
                {turn.question}
              </div>
            </div>
            {isRemote ? (
              <ResponseCell r={turn.llama} />
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                <ResponseCell r={turn.llama} />
                <ResponseCell r={turn.qwen} />
              </div>
            )}
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
            placeholder={isRemote ? "Ask the AI Agent…" : "Ask both models…"}
            disabled={loading}
            className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700/60 text-slate-100 text-[12px] rounded-xl px-3 py-2.5 placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            aria-label="Send"
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
