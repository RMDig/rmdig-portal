/**
 * Regenerates the bundled US Census reference data the ad target picker's admin
 * selector reads (AD-P7b, AvApp doc 31 §3). Off-the-shelf, public-domain Census
 * Gazetteer files (TIGER-derived) — national coverage on day one, no avalanche
 * dependency (T23).
 *
 *   pnpm tsx scripts/build-geo-data.ts
 *
 * Output (committed): lib/geo/data/{states,counties,places}.json — each an array of
 * { fips, name, usps, lat, lon } trimmed from the Gazetteer. Counties/places come
 * straight from the national Gazetteer; states are the canonical 56 (50 + DC + 5
 * territories) with a centroid derived as the mean of their counties' interior
 * points (good enough to center a map; admin matching is polygon-based on-device).
 *
 * Source files (public domain):
 *   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/<YEAR>_Gazetteer/
 * The Gazetteer is UTF-8 — decoded as such so accented place names (Cañon City,
 * Española) round-trip cleanly.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const YEAR = 2024;
const BASE = `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${YEAR}_Gazetteer`;
const OUT_DIR = join(import.meta.dirname, "..", "lib", "geo", "data");

// One trimmed reference row. `fips` is the GEOID (2-digit state, 5-digit county,
// 7-digit place); `lat`/`lon` are the Gazetteer interior point.
interface GeoRow {
  fips: string;
  name: string;
  usps: string;
  lat: number;
  lon: number;
}

// The canonical 56 state-level units (USPS → FIPS + display name): 50 states + DC +
// the five inhabited territories the Gazetteer county file covers. FIPS is the
// 2-digit state code; the centroid is filled in from county data below.
const STATES: Record<string, { fips: string; name: string }> = {
  AL: { fips: "01", name: "Alabama" }, AK: { fips: "02", name: "Alaska" },
  AZ: { fips: "04", name: "Arizona" }, AR: { fips: "05", name: "Arkansas" },
  CA: { fips: "06", name: "California" }, CO: { fips: "08", name: "Colorado" },
  CT: { fips: "09", name: "Connecticut" }, DE: { fips: "10", name: "Delaware" },
  DC: { fips: "11", name: "District of Columbia" }, FL: { fips: "12", name: "Florida" },
  GA: { fips: "13", name: "Georgia" }, HI: { fips: "15", name: "Hawaii" },
  ID: { fips: "16", name: "Idaho" }, IL: { fips: "17", name: "Illinois" },
  IN: { fips: "18", name: "Indiana" }, IA: { fips: "19", name: "Iowa" },
  KS: { fips: "20", name: "Kansas" }, KY: { fips: "21", name: "Kentucky" },
  LA: { fips: "22", name: "Louisiana" }, ME: { fips: "23", name: "Maine" },
  MD: { fips: "24", name: "Maryland" }, MA: { fips: "25", name: "Massachusetts" },
  MI: { fips: "26", name: "Michigan" }, MN: { fips: "27", name: "Minnesota" },
  MS: { fips: "28", name: "Mississippi" }, MO: { fips: "29", name: "Missouri" },
  MT: { fips: "30", name: "Montana" }, NE: { fips: "31", name: "Nebraska" },
  NV: { fips: "32", name: "Nevada" }, NH: { fips: "33", name: "New Hampshire" },
  NJ: { fips: "34", name: "New Jersey" }, NM: { fips: "35", name: "New Mexico" },
  NY: { fips: "36", name: "New York" }, NC: { fips: "37", name: "North Carolina" },
  ND: { fips: "38", name: "North Dakota" }, OH: { fips: "39", name: "Ohio" },
  OK: { fips: "40", name: "Oklahoma" }, OR: { fips: "41", name: "Oregon" },
  PA: { fips: "42", name: "Pennsylvania" }, RI: { fips: "44", name: "Rhode Island" },
  SC: { fips: "45", name: "South Carolina" }, SD: { fips: "46", name: "South Dakota" },
  TN: { fips: "47", name: "Tennessee" }, TX: { fips: "48", name: "Texas" },
  UT: { fips: "49", name: "Utah" }, VT: { fips: "50", name: "Vermont" },
  VA: { fips: "51", name: "Virginia" }, WA: { fips: "53", name: "Washington" },
  WV: { fips: "54", name: "West Virginia" }, WI: { fips: "55", name: "Wisconsin" },
  WY: { fips: "56", name: "Wyoming" }, AS: { fips: "60", name: "American Samoa" },
  GU: { fips: "66", name: "Guam" }, MP: { fips: "69", name: "Northern Mariana Islands" },
  PR: { fips: "72", name: "Puerto Rico" }, VI: { fips: "78", name: "U.S. Virgin Islands" },
};

// Fetch a Gazetteer zip and return its single TSV's lines, Latin-1 decoded. Uses the
// system `unzip -p` (extract to stdout) rather than a JS zip dep — this is a one-off
// build script, not app code.
async function fetchGazetteerLines(file: string): Promise<string[]> {
  const url = `${BASE}/${file}`;
  process.stdout.write(`  fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const zipPath = join(tmpdir(), file);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  // The Gazetteer is UTF-8; decode as such so accented names round-trip.
  const tsv = execFileSync("unzip", ["-p", zipPath], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return tsv.split("\n").filter((l) => l.trim().length > 0);
}

// Resolve column positions by header NAME (not fixed index) so the county and place
// schemas — which differ (places carry LSAD/FUNCSTAT) — both parse correctly.
function parseGazetteer(lines: string[]): GeoRow[] {
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`missing column ${name} in [${header.join(", ")}]`);
    return i;
  };
  const [iUsps, iGeoid, iName, iLat, iLon] = [
    col("USPS"), col("GEOID"), col("NAME"), col("INTPTLAT"), col("INTPTLONG"),
  ];
  return lines.slice(1).map((line) => {
    const f = line.split("\t");
    const at = (i: number): string => (f[i] ?? "").trim();
    return {
      fips: at(iGeoid),
      name: at(iName),
      usps: at(iUsps),
      lat: Number(at(iLat)),
      lon: Number(at(iLon)),
    };
  });
}

// Stable sort + compact single-line JSON keeps the committed diff readable and the
// server-side load fast.
function writeJson(name: string, rows: GeoRow[]): void {
  rows.sort((a, b) => a.usps.localeCompare(b.usps) || a.name.localeCompare(b.name));
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(rows) + "\n");
  process.stdout.write(`  wrote ${name}.json (${rows.length} rows)\n`);
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  process.stdout.write("counties:\n");
  const counties = parseGazetteer(await fetchGazetteerLines(`${YEAR}_Gaz_counties_national.zip`));

  process.stdout.write("places:\n");
  const places = parseGazetteer(await fetchGazetteerLines(`${YEAR}_Gaz_place_national.zip`));

  // States: canonical 56, centroid = mean of the state's interior points. Counties
  // are preferred; some territories (e.g. American Samoa) aren't in the counties file,
  // so fall back to places, which covers them. A unit absent from both is skipped
  // (warned, not fatal) so a Gazetteer coverage gap can't break the build.
  const byState = new Map<string, { lat: number; lon: number; n: number }>();
  const accumulate = (rows: GeoRow[]) => {
    for (const r of rows) {
      const agg = byState.get(r.usps) ?? { lat: 0, lon: 0, n: 0 };
      agg.lat += r.lat;
      agg.lon += r.lon;
      agg.n += 1;
      byState.set(r.usps, agg);
    }
  };
  accumulate(counties);
  accumulate(places.filter((p) => !byState.has(p.usps))); // only fill states counties missed
  const states: GeoRow[] = [];
  for (const [usps, { fips, name }] of Object.entries(STATES)) {
    const agg = byState.get(usps);
    if (!agg) {
      process.stderr.write(`  WARN: no Census rows for ${usps} (${name}) — skipping\n`);
      continue;
    }
    states.push({ fips, name, usps, lat: agg.lat / agg.n, lon: agg.lon / agg.n });
  }

  writeJson("states", states);
  writeJson("counties", counties);
  writeJson("places", places);
}

main().catch((err) => {
  process.stderr.write(`build-geo-data failed: ${(err as Error).message}\n`);
  process.exit(1);
});
