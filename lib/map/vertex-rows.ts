// The keyboard path for a service area (plan 33 §6.3 step 4, step 9.6; WCAG
// 2.1.1): its corner points as rows of latitude and longitude text, converted
// to and from the GeoJSON polygon the map draws. GeoJSON order is [lon, lat];
// the table shows latitude first, as people read coordinates.
//
// Only the outer ring is listed. A drawing never has holes, and the server
// re-checks whatever comes back (assessArea, RegionPolygonSchema).

export interface VertexRow {
  lat: string;
  lon: string;
}

export interface VertexPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface VertexRowError {
  /** 0-based index into the rows given. */
  row: number;
  field: "lat" | "lon";
  message: string;
}

export type RowsResult =
  | { ok: true; polygon: VertexPolygon; points: number }
  | { ok: false; message: string; errors: VertexRowError[] };

/** Matches the decimals the sync keeps (lib/sar/geo.ts SYNC_DECIMALS), about 10 cm. */
const DECIMALS = 6;
const MIN_POINTS = 3;

export const emptyRows = (n = MIN_POINTS): VertexRow[] => Array.from({ length: n }, () => ({ lat: "", lon: "" }));

const fmt = (v: number) => String(Number(v.toFixed(DECIMALS)));

/** The polygon's outer ring as rows, without the closing point that repeats the first. */
export function rowsFromPolygon(polygon: VertexPolygon): VertexRow[] {
  const ring = polygon.coordinates[0] ?? [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = ring.length > 1 && first && last && first[0] === last[0] && first[1] === last[1];
  return (closed ? ring.slice(0, -1) : ring).map(([lon = 0, lat = 0]) => ({ lat: fmt(lat), lon: fmt(lon) }));
}

function parseCoord(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  return v >= min && v <= max ? v : null;
}

/**
 * Rows to a closed polygon. Blank rows are skipped; a half-filled or out-of-range
 * row is an error on that field, numbered as the table numbers it.
 */
export function polygonFromRows(rows: VertexRow[]): RowsResult {
  const errors: VertexRowError[] = [];
  const points: number[][] = [];
  rows.forEach((r, row) => {
    if (r.lat.trim() === "" && r.lon.trim() === "") return;
    const lat = parseCoord(r.lat, -90, 90);
    const lon = parseCoord(r.lon, -180, 180);
    if (lat === null) errors.push({ row, field: "lat", message: `Point ${row + 1}: enter a latitude between -90 and 90, like 39.7392.` });
    if (lon === null) errors.push({ row, field: "lon", message: `Point ${row + 1}: enter a longitude between -180 and 180, like -104.9903.` });
    if (lat !== null && lon !== null) points.push([lon, lat]);
  });
  if (errors.length > 0) return { ok: false, message: "Fix the points marked below.", errors };

  // Drop a closing point typed in by hand; the ring is closed below.
  const [first] = points;
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) points.pop();
  const distinct = new Set(points.map(([lon, lat]) => `${lon},${lat}`));
  const [start] = points;
  if (!start || distinct.size < MIN_POINTS) {
    return { ok: false, message: `An area needs at least ${MIN_POINTS} different points.`, errors: [] };
  }
  return { ok: true, polygon: { type: "Polygon", coordinates: [[...points, [...start]]] }, points: points.length };
}
