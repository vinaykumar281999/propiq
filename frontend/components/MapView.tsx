"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import {
  Property,
  Amenity,
  DemographicsData,
  investmentScore,
  badge,
  BADGE_INFO,
  formatMoney,
  fetchAmenitiesInBounds,
  fetchDemographicsBatch,
} from "@/lib/api";

function LegendRow({ color, label, round = false }: { color: string; label: string; round?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-3 h-3 flex-none ${round ? "rounded-full" : "rounded-sm"}`}
        style={{ background: color }}
      />
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

interface Props {
  properties: Property[];
  selected: Property | null;
  onSelect: (p: Property) => void;
  visible: boolean;
}

type OverlayMode = "score" | "income" | "population" | "under18";

const DENVER_CENTER: [number, number] = [39.7392, -104.9903];
const DEFAULT_ZOOM = 11;

// ── colour helpers ──────────────────────────────────────────────────────────

function hexColor(roi: number): string {
  const s = investmentScore(roi);
  if (s >= 70) return "#10b981";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}

function incomeColor(income: number | null): string {
  if (!income) return "#374151";
  if (income >= 100000) return "#10b981";
  if (income >= 70000)  return "#6366f1";
  if (income >= 50000)  return "#f59e0b";
  return "#ef4444";
}

function populationColor(pop: number | null): string {
  if (!pop) return "#374151";
  if (pop >= 5000) return "#6366f1";
  if (pop >= 2000) return "#8b5cf6";
  if (pop >= 1000) return "#a78bfa";
  return "#c4b5fd";
}

function under18Color(pct: number | null): string {
  if (!pct) return "#374151";
  if (pct >= 30) return "#f97316";
  if (pct >= 22) return "#fb923c";
  if (pct >= 15) return "#fdba74";
  return "#374151";
}

function amenityColor(type: Amenity["type"]): string {
  if (type === "gas_station") return "#f59e0b";
  if (type === "school")      return "#3b82f6";
  return "#ef4444"; // hospital
}

function amenityIcon(type: Amenity["type"]): string {
  if (type === "gas_station") return "⛽";
  if (type === "school")      return "🏫";
  return "🏥";
}

function tooltipHtml(p: Property): string {
  const b     = badge(p.roi_pct);
  const color = hexColor(p.roi_pct);
  const score = investmentScore(p.roi_pct);
  return `
    <div class="propiq-tip">
      <div class="propiq-tip-name">${p.name}</div>
      <div class="propiq-tip-badge" style="color:${color}">${BADGE_INFO[b].label}</div>
      <div class="propiq-tip-meta">Score ${score} · ${formatMoney(p.price)}</div>
    </div>`;
}

// ── component ───────────────────────────────────────────────────────────────

export default function MapView({ properties, selected, onSelect, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any | null>(null);
  const polygonsRef  = useRef<Map<number, any>>(new Map());
  const amenityLayerRef = useRef<any | null>(null);

  const [overlay, setOverlay]     = useState<OverlayMode>("score");
  const [showAmenities, setShowAmenities] = useState(false);
  const [amenityTypes, setAmenityTypes]   = useState({
    gas_station: true,
    school: true,
    hospital: true,
  });
  const [demoData, setDemoData]   = useState<Record<string, DemographicsData>>({});
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [amenitiesLoaded, setAmenitiesLoaded] = useState(false);

  const indexed = useMemo(() => properties.filter((p) => p.h3_7 || p.h3_index), [properties]);

  const demoFetchedRef = useRef(false);

  // Load demographic batch data once, the first time the user switches away from score overlay.
  // demoData is intentionally excluded from deps — including it caused an infinite loop because
  // setDemoData triggers the effect again before the non-empty check can gate it.
  useEffect(() => {
    if (overlay !== "score" && !demoFetchedRef.current) {
      demoFetchedRef.current = true;
      fetchDemographicsBatch().then(setDemoData);
    }
  }, [overlay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load amenities when the toggle is turned on
  useEffect(() => {
    if (showAmenities && !amenitiesLoaded) {
      // Denver metro bounding box
      fetchAmenitiesInBounds(39.3, -105.6, 40.2, -104.3).then((data) => {
        setAmenities(data);
        setAmenitiesLoaded(true);
      });
    }
  }, [showAmenities, amenitiesLoaded]);

  const polyColorForOverlay = useCallback(
    (p: Property): string => {
      if (overlay === "score") return hexColor(p.roi_pct);
      const cell  = p.h3_7 || p.h3_index;
      const demo  = cell ? demoData[cell] : null;
      if (overlay === "income")     return incomeColor(demo?.median_income ?? null);
      if (overlay === "population") return populationColor(demo?.total_pop ?? null);
      if (overlay === "under18")    return under18Color(demo?.pct_under_18 ?? null);
      return hexColor(p.roi_pct);
    },
    [overlay, demoData],
  );

  const applyHighlight = useCallback((selectedId: number | null) => {
    polygonsRef.current.forEach((poly, id) => {
      const active = id === selectedId;
      poly.setStyle({
        fillOpacity: active ? 0.75 : 0.3,
        weight:      active ? 2.5  : 1,
        opacity:     active ? 1    : 0.65,
      });
      if (active) poly.bringToFront();
    });
  }, []);

  // Redraw polygon colours when overlay or demoData changes
  useEffect(() => {
    polygonsRef.current.forEach((poly, id) => {
      const p = indexed.find((x) => x.id === id);
      if (!p) return;
      const color = polyColorForOverlay(p);
      poly.setStyle({ color, fillColor: color });
    });
  }, [overlay, demoData, polyColorForOverlay, indexed]);

  // Draw / remove amenity markers when amenities or toggle changes
  useEffect(() => {
    if (!mapRef.current) return;
    // Dynamically import leaflet for the marker layer
    import("leaflet").then((mod) => {
      const L = mod.default;

      // Remove existing layer
      if (amenityLayerRef.current) {
        amenityLayerRef.current.remove();
        amenityLayerRef.current = null;
      }

      if (!showAmenities || !amenities.length) return;

      const activeTypes = (Object.entries(amenityTypes) as [Amenity["type"], boolean][])
        .filter(([, on]) => on)
        .map(([t]) => t);

      const group = L.layerGroup();
      amenities
        .filter((a) => activeTypes.includes(a.type))
        .forEach((a) => {
          const color = amenityColor(a.type);
          const marker = L.circleMarker([a.lat, a.lng], {
            radius:      5,
            color,
            fillColor:   color,
            fillOpacity: 0.85,
            weight:      1.5,
          });
          marker.bindTooltip(
            `<div class="propiq-tip-name" style="font-size:11px">
               ${amenityIcon(a.type)} ${a.name || a.type.replace("_", " ")}
             </div>`,
            { className: "propiq-tooltip", sticky: true },
          );
          group.addLayer(marker);
        });

      group.addTo(mapRef.current);
      amenityLayerRef.current = group;
    });
  }, [showAmenities, amenities, amenityTypes]);

  // Initialise Leaflet map once on mount
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    Promise.all([
      import("leaflet").then((m) => m.default),
      import("h3-js"),
    ]).then(([L, h3]) => {
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center:      DENVER_CENTER,
        zoom:        DEFAULT_ZOOM,
        zoomControl: true,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · © <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom:    20,
        },
      ).addTo(map);

      // Census TIGER city boundary outlines
      const tigerUrl =
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CityTownship/MapServer/0/query" +
        "?where=STATEFP%3D%2708%27" +
        "&geometry=-105.6%2C39.3%2C-104.3%2C40.2" +
        "&geometryType=esriGeometryEnvelope" +
        "&inSR=4326&outFields=NAME&f=geojson&outSR=4326";

      fetch(tigerUrl)
        .then((r) => r.json())
        .then((geojson) => {
          if (cancelled) return;
          L.geoJSON(geojson as GeoJSON.FeatureCollection, {
            style: { color: "#2e2e4a", weight: 1.5, fillOpacity: 0, opacity: 0.8 },
            onEachFeature: (feature, layer) => {
              const name = (feature.properties as Record<string, string>)?.NAME;
              if (name) layer.bindTooltip(name, { permanent: false, className: "propiq-city-label" });
            },
          }).addTo(map);
        })
        .catch(() => {/* TIGER optional */});

      // H3 hexagons for each geocoded neighbourhood
      indexed.forEach((property) => {
        const cell  = (property.h3_7 || property.h3_index)!;
        const boundary = h3.cellToBoundary(cell);
        const color    = hexColor(property.roi_pct);

        const poly = L.polygon(boundary as [number, number][], {
          color,
          fillColor:   color,
          fillOpacity: 0.3,
          weight:      1,
          opacity:     0.65,
        });

        poly.bindTooltip(tooltipHtml(property), { className: "propiq-tooltip", sticky: true });
        poly.on("click", () => onSelect(property));
        poly.on("mouseover", function () {
          if (property.id !== (selected?.id ?? -1))
            poly.setStyle({ fillOpacity: 0.55, weight: 1.5 });
        });
        poly.on("mouseout", function () {
          if (property.id !== (selected?.id ?? -1))
            poly.setStyle({ fillOpacity: 0.3, weight: 1 });
        });

        poly.addTo(map);
        polygonsRef.current.set(property.id, poly);
      });

      mapRef.current = map;
      applyHighlight(null);
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current  = null;
        amenityLayerRef.current = null;
        polygonsRef.current.clear();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (visible && mapRef.current) {
      setTimeout(() => mapRef.current?.invalidateSize(), 60);
    }
  }, [visible]);

  useEffect(() => {
    applyHighlight(selected?.id ?? null);
  }, [selected, applyHighlight]);

  // ── UI ─────────────────────────────────────────────────────────────────────

  const OVERLAY_OPTS: { key: OverlayMode; label: string; icon: string }[] = [
    { key: "score",      label: "Appreciation", icon: "◈" },
    { key: "income",     label: "Income",        icon: "◉" },
    { key: "population", label: "Population",    icon: "◎" },
    { key: "under18",    label: "Youth %",       icon: "◌" },
  ];

  const GLASS = "backdrop-blur-md bg-slate-900/80 border border-slate-800/80 shadow-xl shadow-black/40";

  const b = selected ? badge(selected.roi_pct) : null;
  const DOT_COLOR = { HOT: "#34d399", WARM: "#fbbf24", COOL: "#f43f5e" };
  const DOT_SHADOW = {
    HOT:  "0 0 8px rgba(52,211,153,0.7)",
    WARM: "0 0 8px rgba(251,191,36,0.7)",
    COOL: "none",
  };

  return (
    <div className="w-full h-full relative">
      {/* Map canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* ── Floating control bubble — top-left ─── */}
      <div className={`absolute top-4 left-4 z-[1000] ${GLASS} rounded-2xl p-3 min-w-[160px]`}>
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Data Layer</p>
        <div className="flex flex-col gap-0.5">
          {OVERLAY_OPTS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setOverlay(key)}
              className={`flex items-center gap-2 w-full text-left text-[11px] px-2.5 py-1.5 rounded-lg font-semibold transition-all ${
                overlay === key
                  ? "bg-gradient-to-r from-emerald-500/20 to-cyan-500/10 text-emerald-400 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <span className="text-[10px] opacity-70">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        <div className="mt-2.5 pt-2.5 border-t border-slate-800/60">
          <button
            onClick={() => setShowAmenities(!showAmenities)}
            className={`flex items-center justify-between w-full text-[11px] px-2.5 py-1.5 rounded-lg font-semibold transition-all ${
              showAmenities
                ? "bg-amber-400/10 text-amber-400 border border-amber-400/25"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
            }`}
          >
            <span>Amenities</span>
            <span className="text-[9px]">{showAmenities ? "▾" : "▸"}</span>
          </button>
          {showAmenities && (
            <div className="mt-2 pl-1 flex flex-col gap-1.5">
              {(["gas_station", "school", "hospital"] as Amenity["type"][]).map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={amenityTypes[t]}
                    onChange={(e) => setAmenityTypes((prev) => ({ ...prev, [t]: e.target.checked }))}
                    className="accent-emerald-400 w-3 h-3 rounded"
                  />
                  <span className="text-[10px] text-slate-400">
                    {amenityIcon(t)} {t.replace("_", " ")}
                  </span>
                </label>
              ))}
              {!amenitiesLoaded && <p className="text-[9px] text-slate-500 pl-5">Loading…</p>}
              {amenitiesLoaded && amenities.length === 0 && (
                <p className="text-[9px] text-slate-500 pl-5">No amenity data yet.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Floating legend — bottom-right ─── */}
      <div className={`absolute bottom-4 right-4 z-[1000] ${GLASS} rounded-2xl px-3 py-3 text-[10px] space-y-1 pointer-events-none min-w-[156px]`}>
        {overlay === "score" && (
          <>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Appreciation Grid</p>
            <LegendRow color="#34d399" label="70+ High Demand" />
            <LegendRow color="#f59e0b" label="50–69 Moderate" />
            <LegendRow color="#ef4444" label="&lt;50 Slow Market" />
          </>
        )}
        {overlay === "income" && (
          <>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Median Income</p>
            <LegendRow color="#34d399" label="$100K+" />
            <LegendRow color="#6366f1" label="$70–100K" />
            <LegendRow color="#f59e0b" label="$50–70K" />
            <LegendRow color="#ef4444" label="&lt;$50K" />
          </>
        )}
        {overlay === "population" && (
          <>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Population</p>
            <LegendRow color="#6366f1" label="5K+ residents" />
            <LegendRow color="#8b5cf6" label="2–5K" />
            <LegendRow color="#a78bfa" label="1–2K" />
            <LegendRow color="#c4b5fd" label="&lt;1K" />
          </>
        )}
        {overlay === "under18" && (
          <>
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Youth %</p>
            <LegendRow color="#f97316" label="30%+" />
            <LegendRow color="#fb923c" label="22–30%" />
            <LegendRow color="#fdba74" label="15–22%" />
            <LegendRow color="#374151" label="&lt;15%" />
          </>
        )}
        {showAmenities && (
          <div className="mt-2 pt-2 border-t border-slate-800/60 space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Amenities</p>
            <LegendRow color="#f59e0b" round label="Gas station" />
            <LegendRow color="#3b82f6" round label="School" />
            <LegendRow color="#ef4444" round label="Hospital" />
          </div>
        )}
        {/* Gradient scale bar */}
        {overlay === "score" && (
          <div className="mt-2 pt-2 border-t border-slate-800/60">
            <div className="h-1.5 rounded-full bg-gradient-to-r from-[#ef4444] via-[#f59e0b] to-[#34d399]" />
            <div className="flex justify-between mt-1">
              <span className="text-[8px] text-slate-500">Low</span>
              <span className="text-[8px] text-slate-500">High</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Selected neighborhood card — bottom-left ─── */}
      {selected && b && (
        <div className={`absolute bottom-4 left-4 z-[1000] ${GLASS} rounded-2xl p-4 max-w-[220px]`}>
          <div className="flex items-center gap-2 mb-2.5">
            <div
              className="w-2 h-2 rounded-full flex-none"
              style={{ background: DOT_COLOR[b], boxShadow: DOT_SHADOW[b] }}
            />
            <p className="text-sm font-bold text-slate-100 truncate leading-tight">{selected.name}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Price</p>
              <p className="text-sm font-bold text-slate-100">{formatMoney(selected.price)}</p>
            </div>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ann. ROI</p>
              <p className="text-sm font-bold text-emerald-400">+{selected.roi_pct.toFixed(1)}%</p>
            </div>
            {selected.days_on_market != null && (
              <div className="col-span-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Sells in</p>
                <p className="text-sm font-bold text-slate-100">{Math.round(selected.days_on_market)} days</p>
              </div>
            )}
          </div>
          <div className="mt-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-slate-400">Score</span>
              <span className="text-[9px] font-semibold text-slate-300">{investmentScore(selected.roi_pct)}/100</span>
            </div>
            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
                style={{ width: `${investmentScore(selected.roi_pct)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {indexed.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#070A13]/60 z-[1000]">
          <p className="text-sm text-slate-500">No geocoded neighbourhoods for this metro yet.</p>
        </div>
      )}
    </div>
  );
}
