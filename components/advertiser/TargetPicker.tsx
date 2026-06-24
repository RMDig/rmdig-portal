"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RADIUS_MAX_MI,
  RADIUS_MIN_MI,
  type AdminLevel,
} from "@/lib/advertiser/target";
import type { GeoUnit } from "@/lib/geo/types";

// The ad target picker (AD-P7b, AvApp doc 31 §3). Lets an advertiser choose WHERE a
// creative shows: National (default), a Radius (pin + 5–250 mi), or an Admin set
// (state / county / place from US Census data). It renders the controls AND the hidden
// form inputs the create action parses (targetKind + kind-specific fields; admin FIPS
// as repeated `fips` inputs) — so it's a self-contained section inside the form.
//
// Critical framing (doc 31 §0.1): this is the advertiser's chosen audience geometry,
// never a user location. Nothing here reads the browser's geolocation.

// MapLibre touches `window` at construction — load the radius map client-only.
const RadiusMap = dynamic(() => import("./RadiusMap"), {
  ssr: false,
  loading: () => (
    <div className="bg-muted/40 h-80 w-full animate-pulse rounded-md border" aria-hidden />
  ),
});

type Mode = "national" | "radius" | AdminLevel;

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "national", label: "National", hint: "Everyone in the app (default)." },
  { value: "radius", label: "Radius", hint: "A point + mileage — a local buy." },
  { value: "state", label: "State(s)", hint: "One or more states." },
  { value: "county", label: "County(ies)", hint: "Counties within a state." },
  { value: "place", label: "City / place", hint: "Named cities and places." },
];

// Default radius center (Colorado-ish, matching the SAR map's default) + a sensible
// starting mileage. The advertiser drags the pin to their area.
const DEFAULT_RADIUS = { lat: 39.0, lon: -105.5, mi: 30 };

function unitLabel(level: AdminLevel, u: GeoUnit): string {
  return level === "state" ? u.name : `${u.name}, ${u.usps}`;
}

export function TargetPicker({ states }: { states: GeoUnit[] }) {
  const [mode, setMode] = useState<Mode>("national");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);

  // Admin selection: the chosen units (deduped by fips) for the current admin level.
  // Cleared when switching to a different level so a county can't linger under "state".
  const [selected, setSelected] = useState<GeoUnit[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(""); // USPS state filter for county/place
  const [remoteResults, setRemoteResults] = useState<GeoUnit[]>([]); // county/place fetch
  const [searching, setSearching] = useState(false);

  const isAdmin = mode === "state" || mode === "county" || mode === "place";
  const level = isAdmin ? (mode as AdminLevel) : null;

  function switchMode(next: Mode) {
    setMode(next);
    setSelected([]);
    setQuery("");
    setScope("");
    setRemoteResults([]);
  }

  function addUnit(u: GeoUnit) {
    setSelected((prev) => (prev.some((p) => p.fips === u.fips) ? prev : [...prev, u]));
  }
  function removeUnit(fips: string) {
    setSelected((prev) => prev.filter((p) => p.fips !== fips));
  }

  // State-level search is over the small bundled list — derived during render, no
  // effect, no round-trip.
  const stateResults = useMemo(() => {
    if (level !== "state") return [];
    const q = query.trim().toLowerCase();
    return q ? states.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 50) : states;
  }, [level, query, states]);

  // County/place are large datasets, so they hit the server endpoint (debounced). The
  // effect only schedules the fetch; all setState happens inside async callbacks (never
  // synchronously in the effect body), and a request id drops stale responses.
  const remoteActive = (level === "county" || level === "place") && !(query.trim() === "" && scope === "");
  const reqId = useRef(0);
  useEffect(() => {
    if (!remoteActive || !level) return;
    const id = ++reqId.current;
    const t = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ level, q: query.trim() });
      if (scope) params.set("state", scope);
      fetch(`/api/geo/search?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results: GeoUnit[] }) => {
          if (id === reqId.current) setRemoteResults(data.results ?? []);
        })
        .catch(() => {
          if (id === reqId.current) setRemoteResults([]);
        })
        .finally(() => {
          if (id === reqId.current) setSearching(false);
        });
    }, 220);
    return () => clearTimeout(t);
  }, [remoteActive, level, query, scope]);

  // What the list renders: bundled state results, or the (visible-only) remote results.
  const results = level === "state" ? stateResults : remoteActive ? remoteResults : [];

  const summary =
    mode === "national"
      ? "Shows to everyone in the app."
      : mode === "radius"
        ? `Within ${radius.mi} mi of ${radius.lat.toFixed(2)}, ${radius.lon.toFixed(2)}.`
        : selected.length === 0
          ? "No areas selected yet — this is required to target by area."
          : `${selected.length} ${mode}${selected.length === 1 ? "" : mode === "county" ? " (counties)" : "s"} selected.`;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Targeting</h2>
        <p className="text-muted-foreground text-xs">
          Where this ad shows. This is your chosen audience area — never a user&apos;s location.
        </p>
      </div>

      {/* targetKind is always submitted; national is the default. */}
      <input type="hidden" name="targetKind" value={isAdmin ? "admin" : mode} />

      <div className="flex flex-wrap gap-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => switchMode(m.value)}
            aria-pressed={mode === m.value}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              mode === m.value
                ? "border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
                : "border-input hover:bg-muted/50"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "radius" ? (
        <div className="space-y-3">
          <RadiusMap
            lat={radius.lat}
            lon={radius.lon}
            mi={radius.mi}
            onCenterChange={(lat, lon) => setRadius((r) => ({ ...r, lat, lon }))}
          />
          <input type="hidden" name="targetLat" value={radius.lat} />
          <input type="hidden" name="targetLon" value={radius.lon} />
          <input type="hidden" name="targetRadiusMi" value={radius.mi} />
          <div className="space-y-1">
            <Label htmlFor="radius-mi">Radius: {radius.mi} mi</Label>
            <input
              id="radius-mi"
              type="range"
              min={RADIUS_MIN_MI}
              max={RADIUS_MAX_MI}
              step={5}
              value={radius.mi}
              onChange={(e) => setRadius((r) => ({ ...r, mi: Number(e.target.value) }))}
              className="w-full"
            />
            <p className="text-muted-foreground text-xs">
              Drag the pin to set the center; {RADIUS_MIN_MI}–{RADIUS_MAX_MI} mi.
            </p>
          </div>
        </div>
      ) : null}

      {isAdmin && level ? (
        <div className="space-y-3">
          <input type="hidden" name="targetAdminLevel" value={level} />
          {selected.map((u) => (
            <input key={u.fips} type="hidden" name="fips" value={u.fips} />
          ))}

          {level !== "state" ? (
            <div className="space-y-1">
              <Label htmlFor="scope-state">Filter by state (optional)</Label>
              <select
                id="scope-state"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="border-input bg-transparent flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs"
              >
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s.fips} value={s.usps}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="admin-search">
              {level === "state" ? "Search states" : `Search ${level}s`}
            </Label>
            <Input
              id="admin-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                level === "state"
                  ? "e.g. Colorado"
                  : level === "county"
                    ? "e.g. Summit"
                    : "e.g. Boulder"
              }
              autoComplete="off"
            />
          </div>

          {/* Selected chips */}
          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.map((u) => (
                <span
                  key={u.fips}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-blue-50 px-2.5 py-1 text-xs text-blue-900 dark:bg-blue-900/30 dark:text-blue-100"
                >
                  {unitLabel(level, u)}
                  <button
                    type="button"
                    onClick={() => removeUnit(u.fips)}
                    aria-label={`Remove ${u.name}`}
                    className="text-blue-700 hover:text-blue-950 dark:text-blue-300"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* Results */}
          {results.length > 0 ? (
            <ul className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
              {results.map((u) => {
                const chosen = selected.some((p) => p.fips === u.fips);
                return (
                  <li key={u.fips}>
                    <button
                      type="button"
                      disabled={chosen}
                      onClick={() => addUnit(u)}
                      className="hover:bg-muted/50 flex w-full items-center justify-between px-3 py-2 text-left disabled:opacity-50"
                    >
                      <span>{unitLabel(level, u)}</span>
                      {chosen ? <span className="text-muted-foreground text-xs">Added</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : searching ? (
            <p className="text-muted-foreground text-xs">Searching…</p>
          ) : level !== "state" && query.trim() === "" && scope === "" ? (
            <p className="text-muted-foreground text-xs">
              Type to search, or pick a state to browse its {level}s.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs">{summary}</p>
    </section>
  );
}
