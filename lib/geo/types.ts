// Shared types for the bundled US Census reference data the ad target picker's admin
// selector reads (AD-P7b, AvApp doc 31 §3). Pure types — safe to import from client
// or server. The data itself (lib/geo/data/*.json) is loaded server-side only
// (lib/geo/lookup.ts) so the ~3 MB places set never reaches the browser bundle.

/** The Census administrative granularity an `admin` ad target selects at. */
export type AdminLevel = "state" | "county" | "place";

/** One trimmed Census unit. `fips` is the GEOID (2-digit state, 5-digit county,
 *  7-digit place); `usps` is the containing state's postal code; `lat`/`lon` are the
 *  Gazetteer interior point. Produced by scripts/build-geo-data.ts. */
export interface GeoUnit {
  fips: string;
  name: string;
  usps: string;
  lat: number;
  lon: number;
}
