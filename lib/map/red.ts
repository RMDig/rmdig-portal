import type { RedFeedResult, RedItem } from "../avserv/sar-feeds";
import { formatMountain } from "../announcements/announcements";
import { alertUserName } from "../sar/intake";
import { circleRing, ringsBounds, type LonLat } from "./geometry";
import type { LayerItem, MapLayer } from "./layers";

// The RED layer (docs/plans/33 §4; AvServ sar_feeds.md §1): alerts AvAI sent
// to the viewer's team, read from every node and merged here. Pure.

export interface MergedRed {
  status: "ready" | "partial" | "error";
  items: RedItem[];
  /** Nodes that didn't answer, with their reason. */
  unavailable: Array<{ node: string; code: string }>;
}

const STATUS_RANK = { open: 0, retracted: 1, resolved: 2 } as const;

function mergeItem(a: RedItem, b: RedItem): RedItem {
  // Any node's resolution wins (plan 46 §5); the one alert both nodes sent is
  // one item with both deliveries, never two alerts.
  const status = STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b.status : a.status;
  const deliveries = [...a.deliveries];
  for (const d of b.deliveries) {
    if (!deliveries.some((x) => x.node === d.node && x.ledgerKey === d.ledgerKey)) deliveries.push(d);
  }
  const newer = (b.lastFix?.at ?? "") > (a.lastFix?.at ?? "") ? b : a;
  // A node that withheld the location (resolved over 24 h ago) is right for
  // both: never show what one node has already stopped disclosing.
  const withheld = status !== "open" && (a.lastFix === null || b.lastFix === null);
  const earliest = (x: string | null, y: string | null) => (x && y ? (x < y ? x : y) : (x ?? y));
  return {
    ...newer,
    status,
    deliveries,
    lastFix: withheld ? null : newer.lastFix,
    plannedRoute: withheld ? null : (newer.plannedRoute ?? a.plannedRoute ?? b.plannedRoute),
    ack: a.ack && b.ack ? (a.ack.at <= b.ack.at ? a.ack : b.ack) : (a.ack ?? b.ack),
    openedAt: earliest(a.openedAt, b.openedAt)!,
    resolvedAt: status === "open" ? null : earliest(a.resolvedAt, b.resolvedAt),
  };
}

export function mergeRedFeeds(results: RedFeedResult[]): MergedRed {
  const unavailable = results.flatMap((r) => (r.ok ? [] : [{ node: r.node, code: r.code }]));
  const answered = results.filter((r): r is Extract<RedFeedResult, { ok: true }> => r.ok);
  if (answered.length === 0) return { status: "error", items: [], unavailable };
  const byId = new Map<string, RedItem>();
  for (const r of answered) {
    for (const item of r.items) {
      const seen = byId.get(item.itemId);
      byId.set(item.itemId, seen ? mergeItem(seen, item) : item);
    }
  }
  const items = [...byId.values()].sort(
    (x, y) => STATUS_RANK[x.status] - STATUS_RANK[y.status] || y.openedAt.localeCompare(x.openedAt),
  );
  return { status: unavailable.length ? "partial" : "ready", items, unavailable };
}

const KIND_LABEL = { overdue: "Missed check-in", send_help: "Send Help", incident: "Incident" } as const;
const STATUS_LABEL = { open: "Open", resolved: "Resolved", retracted: "Retracted by the user" } as const;
const OPEN = "#dc2626";
const CLOSED = "#6b7280";
// An accuracy circle is drawn at least this big so a precise fix stays visible.
const MIN_RADIUS_M = 30;

function ago(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function redItem(orgId: string, a: RedItem, now: Date): LayerItem {
  const fix = a.lastFix;
  const point: LonLat | null = fix ? [fix.lon, fix.lat] : null;
  const rings = fix ? [circleRing(fix.lon, fix.lat, Math.max(fix.accuracyMeters ?? 0, MIN_RADIUS_M) / 1609.344)] : null;
  const lines = a.plannedRoute?.coordinates ?? null;
  const where = fix
    ? `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}${fix.accuracyMeters != null ? ` (±${Math.round(fix.accuracyMeters)} m)` : ""}, ${fix.at ? ago(fix.at, now) : "fix time unknown"}`
    : a.status === "open"
      ? "No location received"
      : "Location no longer shown";
  const parts = [STATUS_LABEL[a.status], where];
  if (a.expectedReturnAt) parts.push(`expected back ${formatMountain(new Date(a.expectedReturnAt))}`);
  if (a.deliveries.length > 1) parts.push(`delivered ${a.deliveries.length} times, one alert`);
  if (a.ack) parts.push("marked received");
  return {
    id: `red:${orgId}:${a.itemId}`,
    label: `${KIND_LABEL[a.kind]}: ${alertUserName(a.userDisplayName)}`,
    detail: parts.join(" · "),
    rings,
    point,
    lines,
    bounds: ringsBounds([...(rings ?? []), ...(lines ?? [])]),
    color: a.status === "open" ? OPEN : CLOSED,
    dashed: a.status !== "open",
  };
}

/** One team's RED layer. A failed read says so and where else to look; it
 *  never renders as an empty map (plan 33 §4 item 6). */
export function redLayer(org: { id: string; name: string }, merged: MergedRed, now: Date): MapLayer {
  const missing = merged.unavailable.map((u) => u.node).join(", ");
  return {
    id: `red:${org.id}`,
    label: `${org.name}: alerts sent to your team`,
    status: merged.status === "error" ? "error" : "ready",
    items: merged.items.map((a) => redItem(org.id, a, now)),
    legend: [
      { color: OPEN, dashed: false, label: "Open alert: last location (dot), its accuracy (circle) and planned route (line)" },
      { color: CLOSED, dashed: true, label: "Resolved or retracted" },
    ],
    emptyText: "No alerts have been sent to your team.",
    notice:
      merged.status === "partial"
        ? `One AvAI server didn't answer (${missing}). An alert only it delivered may be missing; the Alerts page lists every alert the portal received.`
        : undefined,
    errorText:
      "Your team's alerts couldn't load from AvAI. The Alerts page lists every alert the portal received, with coordinates. In an emergency, call 911.",
    link: { href: `/sar/${org.id}/alerts`, label: "Open the Alerts page" },
  };
}
