"use client";
import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "agent";
  text: string;
  tools?: string[];
}

type HistoryItem = { role: "user" | "assistant"; content: string };

interface Props {
  neighborhood: string;
  lat: number | null;
  lng: number | null;
}

const SUGGESTIONS = [
  "Good for families?",
  "Monthly mortgage on $500K?",
  "What makes this special?",
  "Compare to Cherry Creek",
  "What are the risks?",
];

const TOOL_LABEL: Record<string, string> = {
  get_price_data:          "Fetching price data",
  get_schools_nearby:      "Checking schools nearby",
  get_hospitals_nearby:    "Checking healthcare access",
  get_lifestyle_amenities: "Scanning amenities",
  get_premium_factors:     "Evaluating premium factors",
  calculate_mortgage:      "Calculating mortgage",
  compare_neighborhoods:   "Comparing neighborhoods",
};

export default function AgentChat({ neighborhood, lat, lng }: Props) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [history, setHistory]     = useState<HistoryItem[]>([]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Reset when neighborhood changes
  useEffect(() => {
    setMessages([]);
    setHistory([]);
    setInput("");
  }, [neighborhood]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, neighborhood, lat, lng, history }),
      });
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          text: data.answer || data.error || "No response received.",
          tools: (data.tools_called as string[]) ?? [],
        },
      ]);
      if (data.history) setHistory(data.history as HistoryItem[]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "agent", text: "Connection error — please try again.", tools: [] },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  const showSuggestions = messages.length === 0 && !loading;

  return (
    <div className="flex flex-col h-full">

      {/* ── Suggestion chips ──────────────────────────────────────────────── */}
      {showSuggestions && (
        <div className="flex-none px-4 pt-3 pb-2">
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

      {/* ── Message list ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-0">
        {messages.map((msg, i) => (
          <div key={i}>
            {/* Tool call pills appear above agent response */}
            {msg.role === "agent" && msg.tools && msg.tools.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5 ml-1">
                {msg.tools.map((t) => (
                  <span
                    key={t}
                    className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-900/30 border border-violet-700/40 text-violet-300"
                  >
                    🔧 {TOOL_LABEL[t] ?? t.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}

            {/* Bubble */}
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-tr-sm shadow-md shadow-indigo-900/40"
                    : "bg-slate-800/80 border border-slate-700/50 text-slate-200 rounded-tl-sm"
                }`}
              >
                {msg.text}
              </div>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800/80 border border-slate-700/50 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input row ─────────────────────────────────────────────────────── */}
      <div className="flex-none px-4 pb-4 pt-2 border-t border-slate-800/60">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask about this neighborhood…"
            disabled={loading}
            className="flex-1 min-w-0 bg-slate-800/60 border border-slate-700/60 text-slate-100 text-[13px] rounded-xl px-3.5 py-2.5 placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 disabled:opacity-50 transition-colors"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            aria-label="Send"
            className="flex-none w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-400 text-black flex items-center justify-center disabled:opacity-35 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

    </div>
  );
}
