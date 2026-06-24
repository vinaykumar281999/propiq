"use client";
import { useState, useEffect, useRef } from "react";
import { geocodeAddress, findNearestByH3, Property } from "@/lib/api";

interface Props {
  allProperties: Property[];
  onSelect: (property: Property, metro: string | null) => void;
}

interface Suggestion {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
}

function shortLabel(displayName: string): string {
  return displayName.split(",").slice(0, 3).join(",").trim();
}

export default function AddressSearch({ allProperties, onSelect }: Props) {
  const [query, setQuery]           = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen]             = useState(false);
  const [fetching, setFetching]     = useState(false);
  const [matching, setMatching]     = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Nominatim autocomplete — debounced 300 ms
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setFetching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1&countrycodes=us`,
          { headers: { "User-Agent": "PropIQ/1.0 (property investment research)" } },
        );
        const data: Suggestion[] = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setFetching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function pickSuggestion(s: Suggestion) {
    setOpen(false);
    setQuery(shortLabel(s.display_name));
    setSuggestions([]);
    setMatching(true);
    setError(null);
    try {
      const match = await findNearestByH3(parseFloat(s.lat), parseFloat(s.lon), allProperties);
      if (!match || match.gridDistance > 200) {
        setError("No neighborhood coverage near this address. Try Denver, CO.");
        return;
      }
      onSelect(match.property, match.property.metro);
      setQuery("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setMatching(false);
    }
  }

  function clear() {
    setQuery(""); setSuggestions([]); setOpen(false); setError(null);
  }

  const busy = fetching || matching;

  return (
    <div ref={containerRef} className="relative">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
        Address Search
      </p>

      <div className="relative">
        {/* Pin icon */}
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none z-10"
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(null); }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Search any address in Colorado…"
          className="w-full bg-[#161B30] border border-slate-700/60 rounded-xl pl-9 pr-9 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400/60 transition-colors"
        />
        {/* Right slot: spinner or clear */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {busy ? (
            <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
          ) : query ? (
            <button onClick={clear} className="text-slate-500 hover:text-slate-300 text-xs leading-none">✕</button>
          ) : null}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="mt-1.5 text-[11px] text-amber-400 flex items-center gap-1.5">
          <span>⚠</span>{error}
        </p>
      )}

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 backdrop-blur-md bg-[#161B30]/95 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={s.place_id}
              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
              className={`w-full text-left px-3 py-2.5 hover:bg-slate-700/40 active:bg-slate-700/60 transition-colors flex items-start gap-2.5 ${i < suggestions.length - 1 ? "border-b border-slate-800/60" : ""}`}
            >
              <svg className="w-3 h-3 text-emerald-400 flex-none mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
              </svg>
              <span className="text-[12px] text-slate-200 leading-snug">{shortLabel(s.display_name)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
