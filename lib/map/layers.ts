import { TEAM_STATUS_LABEL } from "../labels";
import { circleRing, ringsBounds, type Bounds, type LonLat } from "./geometry";

// The layer model behind /map (docs/plans/33). Pure: the page's server
// queries produce plain rows, these builders turn them into layers, and the
// client only draws what it's given, so nothing outside the viewer's scope
// ever reaches the browser. Later phases add remote layers (alerts from
// AvServ) through the same shape, which is why every layer carries a status.

export type LayerStatus = "ready" | "loading" | "error";

/** Where an item sits in the panel's list and in the map's draw order: open
 *  alerts first and on top, then closed ones, service areas, ad targets. */
export type ItemGroup = "open-alert" | "closed-alert" | "area" | "target";

/** The legend's picture of a shape, drawn as it looks on the map. */
export type Glyph = "dot" | "hollow-dot" | "ring" | "line" | "area";

export interface LegendEntry {
  glyph: Glyph;
  color: string;
  dashed: boolean;
  label: string;
}

export interface LayerItem {
  id: string;
  group: ItemGroup;
  label: string;
  /** One short line for the list. */
  summary: string;
  /** Everything we know, in words: shown for the selected item and in its popup. */
  detail: string;
  /** When an alert opened (ISO), so open alerts from several teams list newest first. */
  at?: string;
  /** Polygon rings to draw, if the item has a shape on the map. */
  rings: number[][][] | null;
  /** A point to mark (e.g. an alert's last location). */
  point?: LonLat | null;
  /** Lines to draw (e.g. a planned route), as MultiLineString coordinates. */
  lines?: number[][][] | null;
  bounds: Bounds | null;
  color: string;
  /** Drawn with a dashed outline (e.g. not yet approved). */
  dashed: boolean;
}

export interface MapLayer {
  id: string;
  label: string;
  status: LayerStatus;
  items: LayerItem[];
  /** Shown in the panel's one legend, in plain words. */
  legend: LegendEntry[];
  emptyText: string;
  /** A warning shown above a layer that loaded only in part. */
  notice?: string;
  /** What to say, and where else to look, when the layer can't load. */
  errorText?: string;
  link?: { href: string; label: string };
}

export type OrgStatus = "pending" | "approved" | "rejected" | "suspended" | "leaving" | "withdrawn";

export interface OrgRow {
  id: string;
  name: string;
  status: OrgStatus;
  /** GeoJSON Polygon coordinates, or null when no area is on file. */
  coordinates: number[][][] | null;
}

// Plain status words only. No routing claim (nothing routes alerts to SAR orgs
// yet), and never "coverage" or "monitored": SAR teams aren't watching anyone.
const ORG_STYLE: Record<OrgStatus, { color: string; dashed: boolean; label: string }> = {
  approved: { color: "#2563eb", dashed: false, label: TEAM_STATUS_LABEL.approved },
  pending: { color: "#6b7280", dashed: true, label: TEAM_STATUS_LABEL.pending },
  suspended: { color: "#d97706", dashed: true, label: TEAM_STATUS_LABEL.suspended },
  leaving: { color: "#6b7280", dashed: true, label: TEAM_STATUS_LABEL.leaving },
  withdrawn: { color: "#9ca3af", dashed: true, label: TEAM_STATUS_LABEL.withdrawn },
  rejected: { color: "#9ca3af", dashed: true, label: TEAM_STATUS_LABEL.rejected },
};

function orgItem(o: OrgRow): LayerItem {
  const s = ORG_STYLE[o.status];
  const detail = o.coordinates ? s.label : `${s.label} · no service area on file`;
  return {
    id: `org:${o.id}`,
    group: "area",
    label: o.name,
    summary: detail,
    detail,
    rings: o.coordinates,
    bounds: o.coordinates ? ringsBounds(o.coordinates) : null,
    color: s.color,
    dashed: s.dashed,
  };
}

function legendFor(rows: OrgRow[]): LegendEntry[] {
  const seen = new Set(rows.map((r) => r.status));
  return (Object.keys(ORG_STYLE) as OrgStatus[])
    .filter((k) => seen.has(k))
    .map((k) => {
      const s = ORG_STYLE[k];
      return { glyph: "area", color: s.color, dashed: s.dashed, label: `Service area: ${s.label.toLowerCase()}` };
    });
}

export function memberOrgLayer(rows: OrgRow[]): MapLayer {
  return {
    id: "my-orgs",
    label: "Your organization's service area",
    status: "ready",
    items: rows.map(orgItem),
    legend: legendFor(rows),
    emptyText: "You're not a member of a search & rescue organization.",
  };
}

/** Staff overview. Rejected and withdrawn orgs are left out. */
export function allOrgsLayer(rows: OrgRow[]): MapLayer {
  const shown = rows.filter((r) => r.status !== "rejected" && r.status !== "withdrawn");
  return {
    id: "all-orgs",
    label: "All search & rescue organizations (staff)",
    status: "ready",
    items: shown.map(orgItem),
    legend: legendFor(shown),
    emptyText: "No organizations have applied yet.",
  };
}

export interface TargetRow {
  id: string;
  headline: string;
  status: string;
  /** Human-readable target, from lib/geo/lookup describeTarget. */
  description: string;
  radius: { lat: number; lon: number; mi: number } | null;
}

const TARGET_COLOR = "#7c3aed";

/** An advertiser's own creatives. Radius targets are drawn; national and
 *  state/county/place targets are listed only, since we don't hold their
 *  boundaries and won't draw an invented shape. */
export function targetLayer(rows: TargetRow[]): MapLayer {
  return {
    id: "my-targets",
    label: "Your ad targets",
    status: "ready",
    items: rows.map((t) => {
      const rings = t.radius ? [circleRing(t.radius.lon, t.radius.lat, t.radius.mi)] : null;
      const detail = rings ? `${t.description} · ${t.status}` : `${t.description} · ${t.status} · area not drawn`;
      return {
        id: `creative:${t.id}`,
        group: "target",
        label: t.headline,
        summary: detail,
        detail,
        rings,
        bounds: rings ? ringsBounds(rings) : null,
        color: TARGET_COLOR,
        dashed: t.status !== "approved",
      };
    }),
    legend: [
      { glyph: "ring", color: TARGET_COLOR, dashed: false, label: "Ad target: approved" },
      { glyph: "ring", color: TARGET_COLOR, dashed: true, label: "Ad target: not yet approved" },
    ],
    emptyText: "No ads yet.",
  };
}

/** Which layers a viewer gets. Each is scoped to the viewer's own data;
 *  only staff see every organization. */
export function layersFor(v: {
  isStaff: boolean;
  memberOrgs: OrgRow[];
  isAdvertiser: boolean;
  targets: TargetRow[];
  allOrgs: OrgRow[] | null;
}): MapLayer[] {
  const layers: MapLayer[] = [];
  if (v.memberOrgs.length > 0) layers.push(memberOrgLayer(v.memberOrgs));
  if (v.isAdvertiser) layers.push(targetLayer(v.targets));
  if (v.isStaff && v.allOrgs) layers.push(allOrgsLayer(v.allOrgs));
  return layers;
}
