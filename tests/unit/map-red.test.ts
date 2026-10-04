import { describe, expect, it } from "vitest";

import type { RedFeedResult, RedItem } from "@/lib/avserv/sar-feeds";
import { mergeRedFeeds, redLayer } from "@/lib/map/red";

// Merging both nodes' RED feeds and drawing the layer (sar_feeds.md §1;
// plan 33 §4 item 6).

const base: RedItem = {
  itemId: "sub-1:team",
  kind: "overdue",
  status: "open",
  userDisplayName: "Pat",
  lastFix: { lat: 39.6, lon: -106, accuracyMeters: 12, at: "2026-10-04T10:00:00Z" },
  plannedRoute: { type: "MultiLineString", coordinates: [[[-106, 39.6], [-106.1, 39.7]]] },
  expectedReturnAt: "2026-10-04T09:00:00Z",
  note: null,
  deliveries: [{ node: "avserv-2", ledgerKey: "k2", channels: ["portal"], deliveredAt: "2026-10-04T10:00:00Z" }],
  ack: null,
  openedAt: "2026-10-04T10:00:00Z",
  resolvedAt: null,
};
const ok = (node: string, items: RedItem[]): RedFeedResult => ({ ok: true, node, items, asOf: "2026-10-04T10:05:00Z" });
const down = (node: string): RedFeedResult => ({ ok: false, node, code: "feed_unavailable" });
const fromNode3 = (o: Partial<RedItem> = {}): RedItem => ({
  ...base,
  deliveries: [{ node: "avserv-3", ledgerKey: "k3", channels: ["portal"], deliveredAt: "2026-10-04T10:00:02Z" }],
  ...o,
});
const NOW = new Date("2026-10-04T10:30:00Z");
const ORG = { id: "org-1", name: "Summit SAR" };

describe("mergeRedFeeds", () => {
  it("shows one alert both nodes sent as one item with both deliveries", () => {
    const m = mergeRedFeeds([ok("a2", [base]), ok("a3", [fromNode3()])]);
    expect(m.status).toBe("ready");
    expect(m.items).toHaveLength(1);
    expect(m.items[0]!.deliveries.map((d) => d.ledgerKey)).toEqual(["k2", "k3"]);
  });

  it("lets any node's resolution win, keeps the newest fix and the first ack", () => {
    const newer = { lat: 39.7, lon: -106.2, accuracyMeters: 5, at: "2026-10-04T10:10:00Z" };
    const m = mergeRedFeeds([
      ok("a2", [{ ...base, ack: { at: "2026-10-04T10:20:00Z", by: "portal-user:b" } }]),
      ok("a3", [fromNode3({ status: "resolved", resolvedAt: "2026-10-04T10:15:00Z", lastFix: newer, ack: { at: "2026-10-04T10:12:00Z", by: "portal-user:a" } })]),
    ]);
    expect(m.items[0]).toMatchObject({ status: "resolved", lastFix: newer, resolvedAt: "2026-10-04T10:15:00Z", ack: { by: "portal-user:a" } });
  });

  it("withholds the location when either node has stopped disclosing it", () => {
    const m = mergeRedFeeds([
      ok("a2", [{ ...base, status: "resolved", resolvedAt: "2026-10-02T10:00:00Z" }]),
      ok("a3", [fromNode3({ status: "resolved", resolvedAt: "2026-10-02T10:00:00Z", lastFix: null, plannedRoute: null })]),
    ]);
    expect(m.items[0]).toMatchObject({ lastFix: null, plannedRoute: null });
  });

  it("is partial with one node down and an error (never empty) with both down", () => {
    expect(mergeRedFeeds([ok("a2", [base]), down("a3")])).toMatchObject({ status: "partial", unavailable: [{ node: "a3" }] });
    expect(mergeRedFeeds([down("a2"), down("a3")])).toMatchObject({ status: "error", items: [] });
    expect(mergeRedFeeds([]).status).toBe("error");
  });

  it("lists open alerts first, newest first", () => {
    const m = mergeRedFeeds([
      ok("a2", [
        { ...base, itemId: "old", openedAt: "2026-10-01T00:00:00Z" },
        { ...base, itemId: "done", status: "resolved", openedAt: "2026-10-04T11:00:00Z" },
        { ...base, itemId: "new", openedAt: "2026-10-04T10:00:00Z" },
      ]),
    ]);
    expect(m.items.map((i) => i.itemId)).toEqual(["new", "old", "done"]);
  });
});

describe("redLayer", () => {
  it("draws the last fix, its accuracy circle and the route, with the details in text", () => {
    const layer = redLayer(ORG, mergeRedFeeds([ok("a2", [base]), ok("a3", [fromNode3()])]), NOW);
    expect(layer).toMatchObject({ id: "red:org-1", status: "ready", label: "Summit SAR: alerts sent to your team" });
    const item = layer.items[0]!;
    expect(item.label).toBe("Missed check-in: Pat");
    expect(item.point).toEqual([-106, 39.6]);
    expect(item.rings).toHaveLength(1);
    expect(item.lines).toEqual(base.plannedRoute!.coordinates);
    expect(item.color).toBe("#dc2626");
    expect(item.detail).toContain("39.60000, -106.00000 (±12 m), 30 min ago");
    expect(item.detail).toContain("delivered 2 times, one alert");
    expect(layer.link).toEqual({ href: "/sar/org-1/alerts", label: "Open the Alerts page" });
  });

  it("says when one node is missing, and what to do when nothing loads", () => {
    expect(redLayer(ORG, mergeRedFeeds([ok("a2", []), down("avserv-3.rmdig.ai")]), NOW).notice).toMatch(/avserv-3\.rmdig\.ai/);
    const failed = redLayer(ORG, mergeRedFeeds([down("a2"), down("a3")]), NOW);
    expect(failed.status).toBe("error");
    expect(failed.errorText).toMatch(/Alerts page.*call 911/);
  });

  it("lists an item without a location but draws nothing for it", () => {
    const item = redLayer(ORG, mergeRedFeeds([ok("a2", [{ ...base, status: "resolved", lastFix: null, plannedRoute: null }])]), NOW).items[0]!;
    expect(item).toMatchObject({ point: null, rings: null, lines: null, bounds: null, dashed: true });
    expect(item.detail).toContain("Location no longer shown");
  });
});
