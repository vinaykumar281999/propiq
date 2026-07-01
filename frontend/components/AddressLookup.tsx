"use client";
import { useState, FormEvent } from "react";
import { geocodeAddress, findNearestByH3, formatMoney, badge, BADGE_INFO, Property } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

interface Props {
  allProperties: Property[];
  onMatch: (property: Property, metro: string | null) => void;
}

type Status =
  | { type: "idle" }
  | { type: "loading"; step: "geocoding" | "matching" }
  | { type: "found"; property: Property; exact: boolean; gridDistance: number; addressLabel: string }
  | { type: "no_coverage"; city: string | null }
  | { type: "error"; message: string };


export default function AddressLookup({ allProperties, onMatch }: Props) {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<Status>({ type: "idle" });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = address.trim();
    if (!q) return;

    setStatus({ type: "loading", step: "geocoding" });

    try {
      const geo = await geocodeAddress(q);
      if (!geo) {
        setStatus({ type: "error", message: "Address not found. Try adding a city or zip code." });
        return;
      }

      setStatus({ type: "loading", step: "matching" });

      const match = await findNearestByH3(geo.lat, geo.lng, allProperties);

      if (!match) {
        setStatus({ type: "no_coverage", city: geo.city });
        return;
      }

      if (match.gridDistance > 200) {
        setStatus({ type: "no_coverage", city: geo.city });
        return;
      }

      const parts = geo.displayName.split(",");
      const addressLabel = parts.slice(0, 3).join(",").trim();

      setStatus({
        type: "found",
        property: match.property,
        exact: match.exact,
        gridDistance: match.gridDistance,
        addressLabel,
      });
    } catch (err) {
      setStatus({ type: "error", message: friendlyError(err) });
    }
  }

  function handleSelect(property: Property) {
    onMatch(property, property.metro);
    setStatus({ type: "idle" });
    setAddress("");
  }

  return (
    <div className="flex-none bg-navy-900/60 border-b border-navy-700 px-4 py-3">
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <div className="relative flex-1 max-w-lg">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <input
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              if (status.type !== "idle") setStatus({ type: "idle" });
            }}
            placeholder="Enter a property address — e.g. 2200 Blake St, Denver CO"
            className="w-full bg-navy-900 border border-navy-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <button
          type="submit"
          disabled={status.type === "loading" || !address.trim()}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors whitespace-nowrap"
        >
          {status.type === "loading" ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {status.step === "geocoding" ? "Finding address…" : "Matching neighborhood…"}
            </span>
          ) : "Find Neighborhood"}
        </button>
      </form>

      {status.type === "found" && (() => {
        const b = badge(status.property.roi_pct);
        return (
          <div className="mt-3 flex items-start justify-between gap-3 bg-navy-900 border border-navy-700 rounded-xl p-3">
            <div className="min-w-0">
              {status.exact ? (
                <p className="text-sm font-semibold text-gray-300">
                  ✅ Your address is in <span className="text-white">{status.property.name}</span>
                </p>
              ) : (
                <p className="text-sm text-gray-400 leading-snug">
                  📍 <span className="text-gray-300">{status.addressLabel}</span>
                  {" — "}nearest neighborhood in our database
                  {status.gridDistance > 0 && (
                    <span className="text-gray-600 text-xs ml-1">
                      ({status.gridDistance} H3 cell{status.gridDistance !== 1 ? "s" : ""} away)
                    </span>
                  )}
                  :
                </p>
              )}

              <div className="flex items-center gap-2 mt-1">
                <p className="text-base font-bold text-white">{status.property.name}</p>
                <span className="text-xs font-semibold text-gray-400">{BADGE_INFO[b].label}</span>
              </div>
              <p className="text-[10px] text-gray-600 mt-0.5">{BADGE_INFO[b].subtitle}</p>

              <p className="text-xs text-gray-500 mt-0.5">
                {formatMoney(status.property.price)}
                {" · "}earn{" "}
                <span className="text-emerald-400 font-semibold">
                  {formatMoney(status.property.expected_return / 2)}
                </span>{" "}
                in 6 months
                {status.property.metro && ` · ${status.property.metro.replace(" metro area", "")}`}
              </p>
            </div>

            <button
              onClick={() => handleSelect(status.property)}
              className="flex-none px-3 py-1.5 rounded-lg bg-navy-700 hover:bg-navy-600 text-gray-300 text-xs font-medium transition-colors whitespace-nowrap"
            >
              View Analysis →
            </button>
          </div>
        );
      })()}

      {status.type === "no_coverage" && (
        <p className="mt-2 text-xs text-amber-400 flex items-center gap-1.5">
          <span>📡</span>
          {status.city
            ? `We don't have geographic coverage for ${status.city} yet. Try an address in Denver, CO.`
            : "No neighborhoods with location data found near this address. Try an address in Denver, CO."}
        </p>
      )}

      {status.type === "error" && (
        <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
          <span>⚠️</span> {status.message}
        </p>
      )}
    </div>
  );
}
