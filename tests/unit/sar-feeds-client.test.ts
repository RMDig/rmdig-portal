import { beforeEach, describe, expect, it, vi } from "vitest";

// One node's RED feed (AvServ sar_feeds.md §1). Failures come back as a code,
// never as an empty list.

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/avserv/request", () => ({ avservFetch: h.fetch, isMock: (u: string) => u.startsWith("mock://") }));

import { readRedFeed, type RedItem } from "@/lib/avserv/sar-feeds";

const NODE = { name: "avserv-2.rmdig.ai", baseUrl: "https://avserv-2.rmdig.ai" };
const item = (id: string): RedItem => ({
  itemId: id,
  kind: "overdue",
  status: "open",
  userDisplayName: "Pat",
  lastFix: { lat: 39.6, lon: -106, accuracyMeters: 10, at: "2026-10-04T10:00:00Z" },
  plannedRoute: null,
  expectedReturnAt: null,
  note: null,
  deliveries: [{ node: "avserv-2", ledgerKey: "k", channels: ["portal"], deliveredAt: "2026-10-04T10:00:00Z" }],
  ack: null,
  openedAt: "2026-10-04T10:00:00Z",
  resolvedAt: null,
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => h.fetch.mockReset());

describe("readRedFeed", () => {
  it("reads every page, naming the viewing member as the reader", async () => {
    h.fetch
      .mockResolvedValueOnce(json(200, { items: [item("a")], nextCursor: "c2", asOf: "2026-10-04T10:01:00Z" }))
      .mockResolvedValueOnce(json(200, { items: [item("b")], nextCursor: null, asOf: "2026-10-04T10:01:01Z" }));
    const r = await readRedFeed(NODE, "org-1", "u1");
    expect(r).toMatchObject({ ok: true, node: NODE.name, asOf: "2026-10-04T10:01:00Z" });
    expect(r.ok && r.items.map((i) => i.itemId)).toEqual(["a", "b"]);
    expect(h.fetch).toHaveBeenNthCalledWith(1, NODE.baseUrl, "/v1/internal/sar-teams/org-1/alerts?limit=200", {
      method: "GET",
      headers: { "x-avai-reader": "portal-user:u1" },
    });
    expect(h.fetch.mock.calls[1]![1]).toBe("/v1/internal/sar-teams/org-1/alerts?limit=200&cursor=c2");
  });

  it("reports AvServ's error code, an unreachable node and a malformed answer as failures", async () => {
    h.fetch.mockResolvedValueOnce(json(503, { code: "feed_unavailable" }));
    expect(await readRedFeed(NODE, "o", "u")).toEqual({ ok: false, node: NODE.name, code: "feed_unavailable" });
    h.fetch.mockRejectedValueOnce(new Error("timeout"));
    expect(await readRedFeed(NODE, "o", "u")).toEqual({ ok: false, node: NODE.name, code: "unreachable" });
    h.fetch.mockResolvedValueOnce(json(200, { items: [{ itemId: "x" }], nextCursor: null, asOf: "t" }));
    expect(await readRedFeed(NODE, "o", "u")).toEqual({ ok: false, node: NODE.name, code: "bad_response" });
    h.fetch.mockResolvedValueOnce(json(404, {}));
    expect(await readRedFeed(NODE, "o", "u")).toEqual({ ok: false, node: NODE.name, code: "http_404" });
  });

  it("fails rather than show a truncated feed past the page cap", async () => {
    h.fetch.mockImplementation(() => Promise.resolve(json(200, { items: [item("a")], nextCursor: "more", asOf: "t" })));
    expect(await readRedFeed(NODE, "o", "u")).toEqual({ ok: false, node: NODE.name, code: "too_many_pages" });
  });

  it("answers an empty feed in mock mode without calling out", async () => {
    const r = await readRedFeed({ name: "mock", baseUrl: "mock://avserv" }, "o", "u");
    expect(r).toMatchObject({ ok: true, items: [] });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
