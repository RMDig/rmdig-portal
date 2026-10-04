import { circleRing, ringsBounds, type Bounds } from "./geometry";

// The layer model behind /map (docs/plans/33). Pure: the page's server
// queries produce plain rows, these builders turn them into layers, and the
// client only draws what it's given, so nothing outside the viewer's scope
// ever reaches the browser. Later phases add remote layers (alerts from
// AvServ) through the same shape, which is why every layer carries a status.

export type LayerStatus = "ready" | "loading" | "error";

export interface LayerItem {
  id: string;
  label: string;
  detail: string;
  /** Polygon rings to draw, if the item has a shape on the map. */
  rings: number[][][] | null;
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
  /** Shown in the legend and the panel, in plain words. */
  legend: Array<{ color: string; dashed: boolean; label: string }>;
  emptyText: string;
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
  approved: { color: "#2563eb", dashed: false, label: "Approved" },
  pending: { color: "#6b7280", dashed: true, label: "Under review" },
  suspended: { color: "#d97706", dashed: true, label: "Suspended" },
  leaving: { color: "#6b7280", dashed: true, label: "Leaving the program" },
  withdrawn: { color: "#9ca3af", dashed: true, label: "Withdrawn" },
  rejected: { color: "#9ca3af", dashed: true, label: "Not approved" },
};

function orgItem(o: OrgRow): LayerItem {
  const s = ORG_STYLE[o.status];
  return {
    id: `org:${o.id}`,
    label: o.name,
    detail: o.coordinates ? s.label : `${s.label} · no service area on file`,
    rings: o.coordinates,
    bounds: o.coordinates ? ringsBounds(o.coordinates) : null,
    color: s.color,
    dashed: s.dashed,
  };
}

function legendFor(rows: OrgRow[]) {
  const seen = new Set(rows.map((r) => r.status));
  return (Object.keys(ORG_STYLE) as OrgStatus[])
    .filter((k) => seen.has(k))
    .map((k) => ORG_STYLE[k]);
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
      return {
        id: `creative:${t.id}`,
        label: t.headline,
        detail: rings ? `${t.description} · ${t.status}` : `${t.description} · ${t.status} · area not drawn`,
        rings,
        bounds: rings ? ringsBounds(rings) : null,
        color: TARGET_COLOR,
        dashed: t.status !== "approved",
      };
    }),
    legend: [
      { color: TARGET_COLOR, dashed: false, label: "Approved ad target" },
      { color: TARGET_COLOR, dashed: true, label: "Not yet approved" },
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
