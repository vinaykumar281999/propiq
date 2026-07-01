"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  fetchProperties, fetchMetros, Property, AddressPoint,
  formatMoney, investmentScore, PERIODS, badge, Badge,
} from "@/lib/api";
import NeighborhoodList from "@/components/NeighborhoodList";
import MapView from "@/components/MapView";
import AddressSearch from "@/components/AddressSearch";
import PriceCutCard from "@/components/PriceCutCard";
import InventoryVelocityCard from "@/components/InventoryVelocityCard";
import type { EvaluationMarker } from "@/app/api/evaluate/route";

const NeighborhoodEvaluator = dynamic(
  () => import("@/components/NeighborhoodEvaluator"),
  { ssr: false },
);

const MobileBottomSheet = dynamic(
  () => import("@/components/MobileBottomSheet"),
  { ssr: false },
);

const TimingAdvisor = dynamic(
  () => import("@/components/TimingAdvisor"),
  { ssr: false },
);

const DEFAULT_METRO = "Denver, CO metro area";

const ROI_FILTERS: { key: "ALL" | Badge; label: string }[] = [
  { key: "ALL",  label: "All"  },
  { key: "HOT",  label: "HOT"  },
  { key: "WARM", label: "WARM" },
  { key: "COOL", label: "COOL" },
];

const ROI_FILTER_ACTIVE_STYLE: Record<"ALL" | Badge, string> = {
  ALL:  "bg-gradient-to-r from-emerald-500 to-cyan-400 text-black shadow-md shadow-emerald-900/40",
  HOT:  "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50",
  WARM: "bg-amber-500/20 text-amber-400 border border-amber-500/50",
  COOL: "bg-rose-500/20 text-rose-400 border border-rose-500/50",
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-700/40 ${className}`} />;
}

function KpiCardSkeleton() {
  return (
    <div className="bg-[#161B30] border border-slate-800/60 rounded-xl p-3">
      <Skeleton className="h-2.5 w-16 mb-2" />
      <Skeleton className="h-5 w-12 mb-2" />
      <Skeleton className="h-2 w-20" />
    </div>
  );
}

function NeighborhoodRowSkeleton() {
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-3 border-b border-slate-800/40">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-32 mb-1.5" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-4 w-10 flex-none" />
    </div>
  );
}

function KpiCard({
  label, value, sub, accent = false,
}: {
  label: string; value: string; sub: string; accent?: boolean;
}) {
  return (
    <div className="bg-[#161B30] border border-slate-800/60 rounded-xl p-3">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{label}</p>
      <p className={`text-xl font-black leading-none ${accent ? "bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent" : "text-slate-100"}`}>
        {value}
      </p>
      <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

export default function Home() {
  const [properties, setProperties]       = useState<Property[]>([]);
  const [metros, setMetros]               = useState<string[]>([]);
  const [selectedMetro, setSelectedMetro] = useState<string>(DEFAULT_METRO);
  const [selected, setSelected]           = useState<Property | null>(null);
  const [addressPin, setAddressPin]       = useState<AddressPoint | null>(null);
  const [search, setSearch]               = useState("");
  const [roiFilter, setRoiFilter]         = useState<"ALL" | Badge>("ALL");
  const [searchFocused, setSearchFocused] = useState(false);
  const [calcPeriod, setCalcPeriod]         = useState(12);
  const [calcAmount, setCalcAmount]         = useState(500000);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState("");
  const [showEvaluator, setShowEvaluator]   = useState(false);
  const [evalMarkers, setEvalMarkers]       = useState<EvaluationMarker[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, metroList] = await Promise.all([fetchProperties(), fetchMetros()]);
      setProperties([...data.properties].sort((a, b) => a.name.localeCompare(b.name)));
      setMetros(metroList);
    } catch {
      setError("Failed to load property data. Please try refreshing.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reset evaluator when selection changes
  useEffect(() => {
    setShowEvaluator(false);
    setEvalMarkers([]);
  }, [selected]);

  // Close neighborhood autocomplete when clicking outside
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const visibleProperties = selectedMetro
    ? properties.filter((p) => p.metro === selectedMetro)
    : properties;

  const filteredProperties = search
    ? visibleProperties.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : visibleProperties;

  const roiFilteredProperties = roiFilter === "ALL"
    ? filteredProperties
    : filteredProperties.filter((p) => badge(p.roi_pct) === roiFilter);

  const count    = visibleProperties.length;
  const avgRoi   = count ? visibleProperties.reduce((s, p) => s + p.roi_pct, 0) / count : 0;
  const avgPrice = count ? visibleProperties.reduce((s, p) => s + p.price,   0) / count : 0;
  const hotCount = visibleProperties.filter((p) => p.roi_pct >= 8).length;

  const nbhdSuggestions = search.trim().length > 0
    ? visibleProperties.filter((p) => p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : [];
  const showNbhdDropdown = searchFocused && nbhdSuggestions.length > 0;

  const calcRoi    = selected ? selected.roi_pct : avgRoi;
  const calcReturn = Math.round(calcAmount * (calcRoi / 100) * (calcPeriod / 12));
  const calcLabel  = PERIODS.find((p) => p.months === calcPeriod)?.label ?? "";

  return (
    <div className="flex h-screen overflow-hidden bg-[#070A13]">

      {/* ── LEFT PANEL — hidden on mobile, visible md+ ───────────────────── */}
      <aside className="hidden md:flex md:flex-col w-[35%] flex-none bg-[#0F1322] border-r border-slate-800/60 overflow-hidden">

        {/* Header */}
        <div className="flex-none px-4 pt-4 pb-3 border-b border-slate-800/60">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 rounded-lg bg-emerald-400/25 blur-md pointer-events-none" />
                <div className="relative w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-400 flex items-center justify-center font-black text-sm text-black shadow-lg shadow-emerald-900/40">
                  P
                </div>
              </div>
              <div>
                <p className="font-black text-[18px] leading-none bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  PropIQ
                </p>
                <span className="text-[9px] font-bold uppercase tracking-widest bg-emerald-400/10 text-emerald-400 border border-emerald-400/30 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                  Enterprise
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/timing"
                className="text-slate-400 hover:text-cyan-400 border border-slate-700/50 hover:border-cyan-500/40 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-all whitespace-nowrap"
              >
                ⏱ Timing
              </Link>
              <button
                onClick={load}
                title="Reload data"
                className="text-slate-500 hover:text-emerald-400 border border-slate-700/50 rounded-lg px-2.5 py-1.5 text-xs transition-colors"
              >
                ↺
              </button>
            </div>
          </div>

          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
            Market / Region
          </label>
          <div className="relative">
            <select
              value={selectedMetro}
              onChange={(e) => { setSelectedMetro(e.target.value); setSelected(null); setSearch(""); setAddressPin(null); }}
              className="w-full appearance-none bg-[#161B30] border border-slate-700/60 text-slate-100 text-sm rounded-lg pl-3 pr-8 py-2 focus:outline-none focus:border-emerald-400/60 transition-colors cursor-pointer"
            >
              <option value="">All Markets</option>
              {metros.map((m) => (
                <option key={m} value={m}>{m.replace(" metro area", "")}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Address Search */}
        {loading && !error && (
          <div className="flex-none px-4 py-3 border-b border-slate-800/60">
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {!loading && !error && (
          <div className="flex-none px-4 py-3 border-b border-slate-800/60">
            <AddressSearch
              allProperties={properties}
              onSelect={(property, metro, addressPoint) => {
                if (metro) setSelectedMetro(metro);
                setSelected(property);
                setAddressPin(addressPoint);
              }}
            />
          </div>
        )}

        {/* KPI 2×2 grid */}
        {loading && !error && (
          <div className="flex-none px-4 py-3 border-b border-slate-800/60">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">Market Overview</p>
            <div className="grid grid-cols-2 gap-2">
              <KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton /><KpiCardSkeleton />
            </div>
          </div>
        )}
        {!loading && !error && (
          <div className="flex-none px-4 py-3 border-b border-slate-800/60">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">Market Overview</p>
            <div className="grid grid-cols-2 gap-2">
              <KpiCard label="Neighborhoods"  value={count.toLocaleString()}    sub="tracked"        />
              <KpiCard label="Avg Annual ROI" value={`${avgRoi.toFixed(1)}%`}   sub="year-over-year" accent />
              <KpiCard label="Median Price"   value={formatMoney(avgPrice)}     sub="avg sale price" />
              <KpiCard label="Hot Markets"    value={hotCount.toString()}        sub="ROI ≥ 8%"       accent />
            </div>
          </div>
        )}

        {/* Neighborhood Search with autocomplete */}
        {loading && !error && (
          <div className="flex-none px-4 py-2.5 border-b border-slate-800/60">
            <Skeleton className="h-9 w-full" />
          </div>
        )}
        {!loading && !error && (
          <div className="flex-none px-4 py-2.5 border-b border-slate-800/60">
            <div ref={searchContainerRef} className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search neighborhoods…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSearchFocused(true); }}
                onFocus={() => setSearchFocused(true)}
                className="w-full bg-[#161B30] border border-slate-700/60 rounded-xl pl-9 pr-8 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-400/60 transition-colors"
              />
              {search && (
                <button
                  onClick={() => { setSearch(""); setSearchFocused(false); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"
                >
                  ✕
                </button>
              )}

              {/* Autocomplete dropdown */}
              {showNbhdDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1.5 backdrop-blur-md bg-[#161B30]/95 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
                  {nbhdSuggestions.map((p, i) => (
                    <button
                      key={p.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSelected(p);
                        setAddressPin(null);
                        setSearch("");
                        setSearchFocused(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 hover:bg-slate-700/40 active:bg-slate-700/60 transition-colors flex items-center justify-between gap-3 ${i < nbhdSuggestions.length - 1 ? "border-b border-slate-800/60" : ""}`}
                    >
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-slate-200 truncate">{p.name}</p>
                        <p className="text-[10px] text-slate-500">{formatMoney(p.price)}</p>
                      </div>
                      <span className={`text-[10px] font-bold flex-none ${p.roi_pct >= 8 ? "text-emerald-400" : p.roi_pct >= 4 ? "text-amber-400" : "text-slate-500"}`}>
                        +{p.roi_pct.toFixed(1)}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Below the fixed header controls: a scrollable neighborhood list on
            top, and a fixed-height detail panel (calculator, price cuts,
            inventory, timing advisor, footer) pinned below it. The two scroll
            independently so browsing the list never pushes the calculator
            out of view. */}
        <div className="flex-1 min-h-0 flex flex-col">

          {/* Neighborhood list — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div>
                <div className="px-4 py-2 flex items-center justify-between">
                  <Skeleton className="h-2.5 w-24" />
                  <Skeleton className="h-2.5 w-12" />
                </div>
                {Array.from({ length: 8 }).map((_, i) => <NeighborhoodRowSkeleton key={i} />)}
              </div>
            ) : error ? (
              <div className="p-4">
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3">{error}</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Neighborhoods</span>
                  <span className="text-[10px] text-slate-500">{roiFilteredProperties.length} shown</span>
                </div>

                {/* Quick ROI filter bar */}
                <div className="px-4 pb-2.5 flex items-center gap-1.5">
                  {ROI_FILTERS.map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setRoiFilter(key)}
                      className={`text-[10px] px-2.5 py-1 rounded-lg font-bold tracking-wide transition-all ${
                        roiFilter === key
                          ? ROI_FILTER_ACTIVE_STYLE[key]
                          : "bg-[#161B30] text-slate-400 hover:text-slate-200 border border-slate-700/60"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <NeighborhoodList
                  properties={roiFilteredProperties}
                  search=""
                  selected={selected}
                  onSelect={(p) => { setSelected(p); setAddressPin(null); }}
                />
              </>
            )}
          </div>

          {/* Fixed bottom panel — calculator always visible, rest scrolls internally if tall */}
          {!loading && !error && (
            <div className="flex-none max-h-[46vh] overflow-y-auto border-t border-slate-800/60">

              {/* Investment Calculator */}
              <div className="px-4 pt-3 pb-4 bg-[#0F1322]/80">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Investment Calculator</p>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1.5">Investment Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">$</span>
                      <input
                        type="number"
                        value={calcAmount}
                        onChange={(e) => setCalcAmount(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full bg-[#161B30] border border-slate-700/60 text-slate-100 text-sm rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:border-emerald-400/60 transition-colors"
                        placeholder="500000"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1.5">Time Period</label>
                    <div className="flex gap-1 flex-wrap">
                      {PERIODS.map((p) => (
                        <button
                          key={p.months}
                          onClick={() => setCalcPeriod(p.months)}
                          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all ${
                            calcPeriod === p.months
                              ? "bg-gradient-to-r from-emerald-500 to-cyan-400 text-black shadow-md shadow-emerald-900/40"
                              : "bg-[#161B30] text-slate-400 hover:text-slate-200 border border-slate-700/60"
                          }`}
                        >
                          {p.short}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={`rounded-xl p-3 border transition-all ${selected ? "bg-gradient-to-r from-emerald-950/50 to-cyan-950/40 border-emerald-800/40" : "bg-[#161B30] border-slate-700/60"}`}>
                    <p className="text-[10px] text-slate-400 mb-0.5">
                      {selected ? `${selected.name} · ` : ""}{calcLabel} return
                    </p>
                    <p className={`text-2xl font-black leading-tight ${selected ? "bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent" : "text-slate-600"}`}>
                      {selected ? `+${formatMoney(calcReturn)}` : "—"}
                    </p>
                    {selected && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-slate-500">ROI score</span>
                          <span className="text-[9px] font-semibold text-slate-400">{investmentScore(selected.roi_pct)}/100</span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-700"
                            style={{ width: `${investmentScore(selected.roi_pct)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {!selected && (
                      <p className="text-[10px] text-slate-600 mt-0.5">Select a neighborhood to calculate</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Price Cut Tracker — shown when a neighborhood is selected */}
              {selected && <PriceCutCard property={selected} />}

              {/* Inventory Velocity — shown when a neighborhood is selected */}
              {selected && <InventoryVelocityCard property={selected} />}

              {/* Timing Advisor — shown when a neighborhood is selected */}
              {selected && (
                <div className="border-t border-slate-800/60">
                  <TimingAdvisor property={selected} />
                </div>
              )}

              {/* Footer */}
              <div className="border-t border-slate-800/60 px-4 py-2">
                <p className="text-[9px] text-slate-600 leading-relaxed">
                  Data: Redfin Jan–May 2026. Projections are estimates, not financial advice.
                </p>
              </div>
            </div>
          )}

        </div>{/* end list + fixed-panel column */}
      </aside>

      {/* ── RIGHT PANEL ─────────────────────────────────────────────────────── */}
      <main className="flex-1 relative overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-slate-700 border-t-emerald-400 rounded-full animate-spin" />
          </div>
        ) : (
          <MapView
            key={selectedMetro}
            properties={visibleProperties}
            selected={selected}
            onSelect={(p) => { setSelected(p); setAddressPin(null); }}
            visible={true}
            evaluationMarkers={evalMarkers}
            addressPin={addressPin}
          />
        )}

        {/* Deep Analysis CTA — top of the right panel, appears the moment a
            neighborhood is selected, disappears once the evaluator opens */}
        {!showEvaluator && selected && (
          <div className="hidden md:block absolute top-4 left-4 z-[1500] w-[300px]">
            <div className="backdrop-blur-md bg-slate-900/90 border border-slate-800/80 shadow-xl shadow-black/40 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full flex-none"
                  style={{ background: { HOT: "#34d399", WARM: "#fbbf24", COOL: "#f43f5e" }[badge(selected.roi_pct)] }}
                />
                <p className="text-sm font-bold text-slate-100 truncate leading-tight">{selected.name}</p>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                {formatMoney(selected.price)} ·{" "}
                <span className="text-emerald-400 font-semibold">+{selected.roi_pct.toFixed(1)}% ROI</span>
                {" · "}Score {investmentScore(selected.roi_pct)}/100
              </p>
              {selected.lat && selected.lng ? (
                <button
                  onClick={() => setShowEvaluator(true)}
                  className="propiq-glow-cta w-full py-3 rounded-xl text-[12px] font-black tracking-wide bg-gradient-to-r from-emerald-500 to-cyan-400 text-black hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <span>⚡</span> Deep Neighborhood Analysis
                </button>
              ) : (
                <p className="text-[10px] text-slate-500">No coordinates available for deep analysis.</p>
              )}
            </div>
          </div>
        )}

        {/* Desktop evaluator overlay — hidden on mobile */}
        {showEvaluator && selected && selected.lat && selected.lng && (
          <div className="hidden md:block absolute right-0 top-0 bottom-0 w-[420px] z-[2000] overflow-hidden">
            <NeighborhoodEvaluator
              neighborhood={selected.name}
              lat={selected.lat}
              lng={selected.lng}
              onClose={() => { setShowEvaluator(false); setEvalMarkers([]); }}
              onEvaluationComplete={setEvalMarkers}
            />
          </div>
        )}

        {/* Mobile bottom sheet — hidden on desktop */}
        {selected && (
          <MobileBottomSheet
            selected={selected}
            onClose={() => { setSelected(null); setAddressPin(null); }}
            onEvaluationComplete={setEvalMarkers}
          />
        )}
      </main>
    </div>
  );
}
