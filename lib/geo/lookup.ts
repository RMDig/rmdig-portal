import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CreativeTarget } from "@/lib/avserv/client";

import type { AdminLevel, GeoUnit } from "./types";

// Server-side lookup over the bundled Census reference data (AD-P7b, doc 31 §3).
// Powers the admin selector's typeahead (app/api/geo/search) and renders readable
// target labels on the operator/advertiser surfaces. The JSON is read from disk with
// `node:fs` (not a static `import`, which would make tsc materialize a 32k-element
// literal type for places.json) — so the ~3 MB places set loads once server-side and
// never ships to the client. The data files are force-traced into the deployment via
// `outputFileTracingIncludes` in next.config.ts. Importing this from a Client Component
// is a build error by construction (node:fs), which is the guard we want.

function load(name: "states" | "counties" | "places"): GeoUnit[] {
  const path = join(process.cwd(), "lib", "geo", "data", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as GeoUnit[];
}

// Loaded once at module init (per server instance). Each row also gets a lowercased
// name cached alongside for case-insensitive matching without re-lowercasing per call.
interface IndexedUnit extends GeoUnit {
  lower: string;
}
function index(rows: GeoUnit[]): IndexedUnit[] {
  return rows.map((r) => ({ ...r, lower: r.name.toLowerCase() }));
}

const DATA: Record<AdminLevel, IndexedUnit[]> = {
  state: index(load("states")),
  county: index(load("counties")),
  place: index(load("places")),
};

// fips → unit, per level, for O(1) validation + label rendering.
const BY_FIPS: Record<AdminLevel, Map<string, GeoUnit>> = {
  state: new Map(DATA.state.map((u) => [u.fips, u])),
  county: new Map(DATA.county.map((u) => [u.fips, u])),
  place: new Map(DATA.place.map((u) => [u.fips, u])),
};

const DEFAULT_LIMIT = 50;

/** The 52 state-level units (50 states + DC + Puerto Rico), for the state dropdown
 *  and the county/place scope filter. Small (~5 KB) so the page passes it inline. */
export function listStates(): GeoUnit[] {
  return DATA.state.map(({ lower: _lower, ...u }) => u);
}

/** Look up a single unit by level + GEOID, or undefined. Used to validate submitted
 *  FIPS server-side (never trust the client) and to render readable labels. */
export function lookupAdmin(level: AdminLevel, fips: string): GeoUnit | undefined {
  return BY_FIPS[level].get(fips);
}

/**
 * Search admin units by name for the picker's typeahead. Case-insensitive; prefix
 * matches rank above interior substring matches, then alphabetical. `state` (a USPS
 * code) scopes county/place results to one state. Capped at `limit` (default 50) so a
 * bare query can't return tens of thousands of rows.
 */
export function searchAdmin(
  level: AdminLevel,
  query: string,
  opts: { state?: string; limit?: number } = {},
): GeoUnit[] {
  const q = query.trim().toLowerCase();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const stateScope = opts.state?.toUpperCase();

  const prefix: IndexedUnit[] = [];
  const contains: IndexedUnit[] = [];
  for (const u of DATA[level]) {
    if (stateScope && u.usps !== stateScope) continue;
    if (q.length === 0) {
      // No query: just list (scoped) units alphabetically up to the cap. Useful for
      // browsing a state's counties without typing.
      prefix.push(u);
      if (prefix.length >= limit) break;
      continue;
    }
    const at = u.lower.indexOf(q);
    if (at === 0) prefix.push(u);
    else if (at > 0) contains.push(u);
    if (prefix.length >= limit) break;
  }

  const ranked = prefix.length >= limit ? prefix : [...prefix, ...contains];
  // Strip the cached lowercase field from the returned shape.
  return ranked.slice(0, limit).map(({ lower: _lower, ...rest }) => rest);
}

const LEVEL_NOUN: Record<AdminLevel, string> = {
  state: "state",
  county: "county",
  place: "place",
};

/**
 * Render a creative's stored target columns as a human-readable label for the
 * operator/advertiser surfaces — e.g. "National", "Within 30 mi of 39.74, -105.00",
 * or "Colorado + 2 more counties". Mirrors `columnsToAdTarget` (lib/advertiser/target)
 * but resolves admin FIPS to names via the reference data, so it lives here.
 */
export function describeTarget(c: {
  targetKind: "national" | "radius" | "admin";
  targetLat: string | null;
  targetLon: string | null;
  targetRadiusMi: number | null;
  targetAdminLevel: AdminLevel | null;
  targetAdminFips: string[] | null;
}): string {
  if (c.targetKind === "radius" && c.targetLat != null && c.targetLon != null && c.targetRadiusMi != null) {
    return `Within ${c.targetRadiusMi} mi of ${Number(c.targetLat).toFixed(2)}, ${Number(c.targetLon).toFixed(2)}`;
  }
  if (c.targetKind === "admin" && c.targetAdminLevel && c.targetAdminFips?.length) {
    const level = c.targetAdminLevel;
    const names = c.targetAdminFips.map((f) => {
      const u = lookupAdmin(level, f);
      if (!u) return f;
      return level === "state" ? u.name : `${u.name}, ${u.usps}`;
    });
    const noun = LEVEL_NOUN[level];
    if (names.length === 1) return `${names[0]} (${noun})`;
    return `${names[0]} + ${names.length - 1} more ${noun}${names.length - 1 === 1 ? "" : "s"}`;
  }
  return "National (everyone)";
}

/** True when every FIPS in `fips` exists at `level` — the server-side existence check
 *  the create action runs before persisting an admin target (don't trust the client). */
export function allFipsExist(level: AdminLevel, fips: string[]): boolean {
  return fips.every((f) => BY_FIPS[level].has(f));
}

export type { AdminLevel, GeoUnit, CreativeTarget };
