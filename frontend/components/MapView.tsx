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

  const OVERLAY_OPTS: { key: OverlayMode; label: string }[] = [
    { key: "score",      label: "Score"  },
    { key: "income",     label: "Income" },
    { key: "population", label: "Pop."   },
    { key: "under18",    label: "<18 yrs"},
  ];

  return (
    <div className="w-full h-full relative">
      {/* Map canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Overlay selector */}
      <div className="absolute top-2 left-2 z-[1000] flex flex-col gap-1.5">
        <div className="bg-navy-900/95 border border-navy-700 rounded-lg px-2 py-1.5 flex gap-1">
          {OVERLAY_OPTS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setOverlay(key)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                overlay === key
                  ? "bg-indigo-600 text-white font-semibold"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Amenity toggle */}
        <div className="bg-navy-900/95 border border-navy-700 rounded-lg px-2 py-1.5">
          <button
            onClick={() => setShowAmenities(!showAmenities)}
            className={`w-full text-[10px] text-left font-semibold transition-colors ${
              showAmenities ? "text-amber-400" : "text-gray-600 hover:text-gray-400"
            }`}
          >
            {showAmenities ? "▼" : "▶"} Amenities
          </button>
          {showAmenities && (
            <div className="mt-1.5 flex flex-col gap-1">
              {(["gas_station", "school", "hospital"] as Amenity["type"][]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={amenityTypes[t]}
                    onChange={(e) => setAmenityTypes((prev) => ({ ...prev, [t]: e.target.checked }))}
                    className="accent-indigo-500 w-3 h-3"
                  />
                  <span className="text-[10px] text-gray-400">
                    {amenityIcon(t)} {t.replace("_", " ")}
                  </span>
                </label>
              ))}
              {showAmenities && !amenitiesLoaded && (
                <p className="text-[9px] text-gray-600 mt-0.5">Loading…</p>
              )}
              {showAmenities && amenitiesLoaded && amenities.length === 0 && (
                <p className="text-[9px] text-gray-600 mt-0.5">No amenity data. Run load/amenities.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-2 z-[1000] bg-navy-900/90 border border-navy-700 rounded-lg px-3 py-2 text-[10px] space-y-1 pointer-events-none">
        {overlay === "score" && (
          <>
            <p className="text-gray-500 font-semibold uppercase tracking-wider mb-1.5">Investment score</p>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#10b981" }} /><span className="text-gray-400">70+ High Demand</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#f59e0b" }} /><span className="text-gray-400">50–69 Moderate</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#ef4444" }} /><span className="text-gray-400">&lt;50 Slow Market</span></div>
          </>
        )}
        {overlay === "income" && (
          <>
            <p className="text-gray-500 font-semibold uppercase tracking-wider mb-1.5">Median income</p>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#10b981" }} /><span className="text-gray-400">$100K+</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#6366f1" }} /><span className="text-gray-400">$70–100K</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#f59e0b" }} /><span className="text-gray-400">$50–70K</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#ef4444" }} /><span className="text-gray-400">&lt;$50K</span></div>
          </>
        )}
        {overlay === "population" && (
          <>
            <p className="text-gray-500 font-semibold uppercase tracking-wider mb-1.5">Population density</p>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#6366f1" }} /><span className="text-gray-400">5K+ residents</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#8b5cf6" }} /><span className="text-gray-400">2–5K</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#a78bfa" }} /><span className="text-gray-400">1–2K</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#c4b5fd" }} /><span className="text-gray-400">&lt;1K</span></div>
          </>
        )}
        {overlay === "under18" && (
          <>
            <p className="text-gray-500 font-semibold uppercase tracking-wider mb-1.5">% Under 18</p>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#f97316" }} /><span className="text-gray-400">30%+</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#fb923c" }} /><span className="text-gray-400">22–30%</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#fdba74" }} /><span className="text-gray-400">15–22%</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm flex-none" style={{ background: "#374151" }} /><span className="text-gray-400">&lt;15%</span></div>
          </>
        )}
        {showAmenities && (
          <div className="mt-2 pt-2 border-t border-navy-700 space-y-1">
            <p className="text-gray-500 font-semibold uppercase tracking-wider mb-1">Amenities</p>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full flex-none" style={{ background: "#f59e0b" }} /><span className="text-gray-400">Gas station</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full flex-none" style={{ background: "#3b82f6" }} /><span className="text-gray-400">School</span></div>
            <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full flex-none" style={{ background: "#ef4444" }} /><span className="text-gray-400">Hospital</span></div>
          </div>
        )}
      </div>

      {indexed.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-navy-950/60 z-[1000]">
          <p className="text-sm text-gray-500">No geocoded neighbourhoods for this metro yet.</p>
        </div>
      )}
    </div>
  );
}
