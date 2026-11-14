import { beforeEach, describe, expect, it, vi } from "vitest";

// The per-node protocol gate (sar_team_sync.md "The version gate"): it passes
// only when every node answers 200 with syncRevision at or above the minimum.
// Anything else (a missing field, a lower value, an old node's 400, a dead
// node) holds.

const h = vi.hoisted(() => ({ fetch: vi.fn(), failureCode: vi.fn(() => "unreachable") }));
vi.mock("@/lib/avserv/request", () => ({
  avservFetch: h.fetch,
  failureCode: h.failureCode,
  isMock: (u: string) => u.startsWith("mock://"),
}));

import { readFleetRevision, readNodeCapability } from "@/lib/avserv/sar-capabilities";

const A = { name: "avserv-2", baseUrl: "https://a2" };
const B = { name: "avserv-3", baseUrl: "https://a3" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => vi.clearAllMocks());

describe("readNodeCapability", () => {
  it("reads the node's revision from the capabilities route", async () => {
    h.fetch.mockResolvedValue(json(200, { syncRevision: 3 }));
    expect(await readNodeCapability(A)).toEqual({ node: "avserv-2", ok: true, syncRevision: 3 });
    expect(h.fetch).toHaveBeenCalledWith("https://a2", "/v1/internal/sar-teams/capabilities", { method: "GET" });
  });

  it("gives no revision for a body without a usable one", async () => {
    h.fetch.mockResolvedValue(json(200, {}));
    expect(await readNodeCapability(A)).toEqual({ node: "avserv-2", ok: true, syncRevision: null });
    h.fetch.mockResolvedValue(json(200, { syncRevision: "3" }));
    expect(await readNodeCapability(A)).toEqual({ node: "avserv-2", ok: true, syncRevision: null });
  });

  it("names an old node's 400, another status, and a dead node", async () => {
    h.fetch.mockResolvedValue(json(400, { code: "invalid_request" }));
    expect(await readNodeCapability(A)).toEqual({ node: "avserv-2", ok: false, code: "invalid_request" });
    h.fetch.mockResolvedValue(json(403, {}));
    expect(await readNodeCapability(A)).toEqual({ node: "avserv-2", ok: false, code: "http_403" });
    h.fetch.mockRejectedValue(new Error("timeout"));
    expect(await readNodeCapability(A)).toEqual({ node: "avserv-2", ok: false, code: "unreachable" });
  });

  it("treats the mock as a fully upgraded node, without a request", async () => {
    expect(await readNodeCapability({ name: "mock", baseUrl: "mock://avserv" })).toEqual({ node: "mock", ok: true, syncRevision: 4 });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("readFleetRevision", () => {
  const answers = (...bodies: Array<[number, unknown]>) => {
    for (const [status, body] of bodies) h.fetch.mockResolvedValueOnce(json(status, body));
  };

  it("is the lowest revision any node reports", async () => {
    answers([200, { syncRevision: 3 }], [200, { syncRevision: 4 }]);
    expect((await readFleetRevision([A, B])).revision).toBe(3);
    answers([200, { syncRevision: 4 }], [200, { syncRevision: 4 }]);
    expect((await readFleetRevision([A, B])).revision).toBe(4);
  });

  it("is 0 when any one node is unreadable or silent on the field, so every gated field holds", async () => {
    answers([200, { syncRevision: 4 }], [400, { code: "invalid_request" }]);
    expect((await readFleetRevision([A, B])).revision).toBe(0);
    answers([200, { syncRevision: 4 }], [200, {}]);
    expect((await readFleetRevision([A, B])).revision).toBe(0);
  });

  it("reports every node's answer, so staff can see which one is behind", async () => {
    answers([200, { syncRevision: 3 }], [200, { syncRevision: 2 }]);
    expect((await readFleetRevision([A, B])).nodes).toEqual([
      { node: "avserv-2", ok: true, syncRevision: 3 },
      { node: "avserv-3", ok: true, syncRevision: 2 },
    ]);
  });

  it("is 0 with no nodes configured", async () => {
    expect(await readFleetRevision([])).toEqual({ revision: 0, nodes: [] });
  });
});
