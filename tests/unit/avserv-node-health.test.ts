import { beforeEach, describe, expect, it, vi } from "vitest";

// The node-health client (AvServ docs/contracts/node_health.md): a valid
// answer is passed through, anything else is a failure code, never "ok".

const h = vi.hoisted(() => ({ fetch: vi.fn(), failureCode: vi.fn(() => "unreachable") }));
vi.mock("@/lib/avserv/request", () => ({
  avservFetch: h.fetch,
  failureCode: h.failureCode,
  isMock: (u: string) => u.startsWith("mock://"),
}));

import { describeHealthCheck, readNodeHealth } from "@/lib/avserv/node-health";

const NODE = { name: "avserv-2", baseUrl: "https://a2" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const GOOD = {
  node: "avserv-2",
  asOf: "2026-10-07T18:00:00Z",
  status: "warn",
  checks: [
    { name: "disk.docker_vm", label: "Docker VM disk", status: "ok", freeBytes: 33e9, totalBytes: 95e9, freePct: 34.7, reason: null },
    { name: "prune.last_run", label: "Docker cleanup", status: "warn", reason: "last ran 2026-10-04 04:10Z, over 48 h ago" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("readNodeHealth", () => {
  it("reads the node's checks from the private route", async () => {
    h.fetch.mockResolvedValue(json(200, GOOD));
    const r = await readNodeHealth(NODE);
    expect(h.fetch).toHaveBeenCalledWith("https://a2", "/v1/internal/node-health", { method: "GET" });
    expect(r).toMatchObject({ ok: true, health: { status: "warn", checks: [{ label: "Docker VM disk" }, { label: "Docker cleanup" }] } });
  });

  it("names AvServ's refusal, an unexpected status, a malformed body and a dead node", async () => {
    h.fetch.mockResolvedValue(json(403, { code: "path_not_allowed" }));
    expect(await readNodeHealth(NODE)).toEqual({ ok: false, node: "avserv-2", code: "path_not_allowed" });
    h.fetch.mockResolvedValue(json(401, {}));
    expect(await readNodeHealth(NODE)).toEqual({ ok: false, node: "avserv-2", code: "http_401" });
    h.fetch.mockResolvedValue(json(200, { ...GOOD, status: "great" }));
    expect(await readNodeHealth(NODE)).toEqual({ ok: false, node: "avserv-2", code: "bad_response" });
    h.fetch.mockRejectedValue(new Error("timeout"));
    expect(await readNodeHealth(NODE)).toEqual({ ok: false, node: "avserv-2", code: "unreachable" });
  });

  it("answers ok with no checks for the mock node, without calling out", async () => {
    expect(await readNodeHealth({ name: "mock", baseUrl: "mock://localhost" })).toMatchObject({ ok: true, health: { checks: [] } });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("describeHealthCheck", () => {
  it("gives space for a disk and AvServ's reason for the rest", () => {
    expect(describeHealthCheck(GOOD.checks[0] as never)).toBe("34.7% free (33.0 of 95.0 GB)");
    expect(describeHealthCheck(GOOD.checks[1] as never)).toBe("last ran 2026-10-04 04:10Z, over 48 h ago");
  });
});
