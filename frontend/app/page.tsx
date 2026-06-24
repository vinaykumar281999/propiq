"use client";
import { useEffect, useState, useCallback } from "react";
import { fetchProperties, fetchMetros, Property } from "@/lib/api";
import NeighborhoodList from "@/components/NeighborhoodList";
import PropertyPanel from "@/components/PropertyPanel";
import HeroCards from "@/components/HeroCards";
import AddressLookup from "@/components/AddressLookup";
import MapView from "@/components/MapView";

const DEFAULT_METRO = "Denver, CO metro area";

export default function Home() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [metros, setMetros] = useState<string[]>([]);
  const [selectedMetro, setSelectedMetro] = useState<string>(DEFAULT_METRO);
  const [selected, setSelected] = useState<Property | null>(null);
  const [search, setSearch] = useState("");
  const [timePeriod, setTimePeriod] = useState(6);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, metroList] = await Promise.all([fetchProperties(), fetchMetros()]);
      setProperties([...data.properties].sort((a, b) => a.name.localeCompare(b.name)));
      setMetros(metroList);
    } catch {
      setError("Failed to load property data. Please try refreshing the page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visibleProperties = selectedMetro
    ? properties.filter((p) => p.metro === selectedMetro)
    : properties;

  const filteredProperties = search
    ? visibleProperties.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : visibleProperties;

  const metroDisplayName = selectedMetro
    ? selectedMetro.replace(" metro area", "")
    : "All cities";

  return (
    <div className="flex flex-col h-screen overflow-hidden">

      {/* Header */}
      <header className="flex-none flex items-center justify-between px-5 py-3 bg-navy-900 border-b border-navy-700">
        <div className="flex items-center gap-3">
          {/* Logo with indigo glow */}
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-indigo-500/25 blur-lg scale-150 pointer-events-none" />
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center text-white font-black text-base shadow-lg shadow-indigo-500/25">
              P
            </div>
          </div>
          <div>
            <p className="font-bold text-white tracking-tight leading-none">PropIQ</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-none">
              {selectedMetro ? selectedMetro.replace(" metro area", "") : "US"} Real Estate Intelligence
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Metro switcher */}
          <div className="relative">
            <select
              value={selectedMetro}
              onChange={(e) => { setSelectedMetro(e.target.value); setSelected(null); setSearch(""); }}
              className="appearance-none bg-navy-800 border border-navy-700 rounded-lg pl-3 pr-8 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
            >
              <option value="">All cities</option>
              {metros.map((m) => (
                <option key={m} value={m}>{m.replace(" metro area", "")}</option>
              ))}
            </select>
            <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {!loading && (
            <span className="text-xs text-gray-600">
              {visibleProperties.length} neighborhoods
            </span>
          )}
          <button onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg border border-navy-700 hover:bg-navy-800 transition-colors text-gray-500">
            Reload
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
          <div className="w-8 h-8 border-2 border-navy-700 border-t-indigo-400 rounded-full animate-spin" />
          <p className="text-sm">Loading neighborhoods…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-5 py-3">{error}</p>
        </div>
      ) : (
        <>
          {/* Address lookup */}
          <AddressLookup
            allProperties={properties}
            onMatch={(property, metro) => {
              if (metro) setSelectedMetro(metro);
              setSelected(property);
              setSearch("");
            }}
          />

          {/* Hero: top 3 picks */}
          <HeroCards
            properties={visibleProperties}
            onSelect={setSelected}
            selected={selected}
            timePeriod={timePeriod}
          />

          {/* Search bar */}
          <div className="flex-none px-4 py-2.5 bg-navy-950 border-b border-navy-800">
            <div className="relative max-w-xs">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder={`Search in ${metroDisplayName}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-navy-900 border border-navy-800 rounded-lg pl-9 pr-8 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-xs">
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Split layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: list or map */}
            <aside className="w-72 flex-none flex flex-col border-r border-navy-800 overflow-hidden">

              {/* Tab switcher */}
              <div className="flex-none flex border-b border-navy-800">
                <button
                  onClick={() => setViewMode("list")}
                  className={`flex-1 py-2 text-xs font-semibold tracking-wide transition-colors ${
                    viewMode === "list"
                      ? "text-white border-b-2 border-indigo-500 bg-navy-900/40"
                      : "text-gray-600 hover:text-gray-400"
                  }`}
                >
                  ☰ List
                </button>
                <button
                  onClick={() => setViewMode("map")}
                  className={`flex-1 py-2 text-xs font-semibold tracking-wide transition-colors ${
                    viewMode === "map"
                      ? "text-white border-b-2 border-indigo-500 bg-navy-900/40"
                      : "text-gray-600 hover:text-gray-400"
                  }`}
                >
                  🗺 Map
                </button>
              </div>

              {/* List view */}
              <div className={`flex flex-col flex-1 overflow-hidden ${viewMode === "list" ? "" : "hidden"}`}>
                <div className="flex-none px-4 py-2 border-b border-navy-800 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
                    Neighborhoods
                  </span>
                  <span className="text-[10px] text-gray-700">
                    {filteredProperties.length} shown
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <NeighborhoodList
                    properties={filteredProperties}
                    search=""
                    selected={selected}
                    onSelect={setSelected}
                  />
                </div>
              </div>

              {/* Map view — stays mounted to avoid Leaflet reinit on tab switch */}
              <div className={`flex-1 overflow-hidden ${viewMode === "map" ? "" : "hidden"}`}>
                <MapView
                  key={selectedMetro}
                  properties={visibleProperties}
                  selected={selected}
                  onSelect={setSelected}
                  visible={viewMode === "map"}
                />
              </div>
            </aside>

            {/* Right: property detail */}
            <main className="flex-1 bg-navy-950 overflow-hidden">
              <PropertyPanel property={selected} timePeriod={timePeriod} setTimePeriod={setTimePeriod} />
            </main>
          </div>
        </>
      )}

      {/* Footer disclaimer */}
      {!loading && !error && (
        <footer className="flex-none border-t border-navy-800 bg-navy-900/60 px-5 py-2.5">
          <p className="text-[10px] text-gray-600 leading-relaxed">
            📊 Market data sourced from Redfin (Jan–May 2026). Return projections are estimates based on current price growth rates and are not guaranteed. This tool is for informational purposes only and does not constitute financial advice. Always consult a licensed real estate professional before making investment decisions.
          </p>
        </footer>
      )}
    </div>
  );
}
