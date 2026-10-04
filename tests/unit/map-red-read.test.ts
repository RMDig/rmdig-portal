import { beforeEach, describe, expect, it, vi } from "vitest";

// Loading a team's RED layer: logged before it's returned; a failed log write
// fails the page; a failed read is an explicit error, logged loudly.

const h = vi.hoisted(() => ({
  read: vi.fn(),
  inserted: [] as unknown[],
  insertError: null as Error | null,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  nodes: [
    { name: "avserv-2.rmdig.ai", baseUrl: "https://avserv-2.rmdig.ai" },
    { name: "avserv-3.rmdig.ai", baseUrl: "https://avserv-3.rmdig.ai" },
  ],
}));
vi.mock("@/lib/avserv/sar-feeds", () => ({ readRedFeed: h.read }));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => h.nodes }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => (h.insertError ? Promise.reject(h.insertError) : (h.inserted.push(v), Promise.resolve())),
    }),
  },
}));

import { loadRedLayers } from "@/lib/map/red-read";

const ORG = { id: "11111111-1111-4111-8111-111111111111", name: "Summit SAR" };
const item = { itemId: "s:t", kind: "send_help", status: "open", userDisplayName: "Pat", lastFix: null, plannedRoute: null, expectedReturnAt: null, note: null, deliveries: [], ack: null, openedAt: "2026-10-04T10:00:00Z", resolvedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.inserted = [];
  h.insertError = null;
});

describe("loadRedLayers", () => {
  it("reads every node as the viewer and logs the items and answering nodes", async () => {
    h.read.mockImplementation((n: { name: string }) =>
      Promise.resolve(n.name.startsWith("avserv-2") ? { ok: true, node: n.name, items: [item], asOf: "t" } : { ok: false, node: n.name, code: "unreachable" }),
    );
    const [layer] = await loadRedLayers("u1", [ORG]);
    expect(h.read).toHaveBeenCalledWith(h.nodes[0], ORG.id, "u1");
    expect(h.read).toHaveBeenCalledWith(h.nodes[1], ORG.id, "u1");
    expect(h.inserted).toEqual([{ orgId: ORG.id, userId: "u1", itemIds: ["s:t"], nodes: ["avserv-2.rmdig.ai"] }]);
    expect(layer!.notice).toMatch(/avserv-3/);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.map.red_node_failed", code: "unreachable" }));
  });

  it("shows an error and logs no view when no node answers", async () => {
    h.read.mockImplementation((n: { name: string }) => Promise.resolve({ ok: false, node: n.name, code: "feed_unavailable" }));
    const [layer] = await loadRedLayers("u1", [ORG]);
    expect(layer!.status).toBe("error");
    expect(h.inserted).toEqual([]);
  });

  it("fails rather than show alerts whose viewing wasn't recorded", async () => {
    h.read.mockImplementation((n: { name: string }) => Promise.resolve({ ok: true, node: n.name, items: [item], asOf: "t" }));
    h.insertError = new Error("db down");
    await expect(loadRedLayers("u1", [ORG])).rejects.toThrow("db down");
  });
});
