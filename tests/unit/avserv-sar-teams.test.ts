import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The AvServ SAR team client (sar_team_sync.md): PUT to one node with every
// answer mapped (never throwing), GET a node's view, and the node list.

vi.mock("@/lib/avserv/service-jwt", () => ({ signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt") }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const body = { orgId: "org-1", revision: 3, status: "approved" } as never;
const NODE = { name: "avserv-2.example", baseUrl: "https://avserv-2.example" };

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "https://avserv-2.example";
  process.env.AVSERV_FAILOVER_BASE_URL = "https://avserv-3.example";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AVSERV_FAILOVER_BASE_URL;
});

describe("avservNodes", () => {
  it("lists both nodes by host, once each", async () => {
    const { avservNodes } = await import("@/lib/avserv/sar-teams");
    expect(avservNodes().map((n) => n.name)).toEqual(["avserv-2.example", "avserv-3.example"]);
    vi.resetModules();
    process.env.AVSERV_FAILOVER_BASE_URL = "https://avserv-2.example";
    expect((await import("@/lib/avserv/sar-teams")).avservNodes()).toHaveLength(1);
  });
});

describe("putSarTeam", () => {
  it("PUTs the body to the org's path and returns the node's answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { orgId: "org-1", revision: 3, applied: true, usable: true, unusableReason: null }));
    vi.stubGlobal("fetch", fetchMock);
    const { putSarTeam } = await import("@/lib/avserv/sar-teams");
    expect(await putSarTeam(NODE, body)).toEqual({ ok: true, result: { orgId: "org-1", revision: 3, applied: true, usable: true, unusableReason: null } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://avserv-2.example/v1/internal/sar-teams/org-1");
    expect(init).toMatchObject({ method: "PUT", body: JSON.stringify(body) });
  });

  it("maps a 422 to its code, not retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(422, { error: "x", code: "capability_invalid" })));
    const { putSarTeam } = await import("@/lib/avserv/sar-teams");
    expect(await putSarTeam(NODE, body)).toMatchObject({ ok: false, status: 422, code: "capability_invalid", retryable: false });
  });

  it("treats a 409 conflict as a portal bug (not retryable) and a 503 as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(409, { code: "revision_conflict" })).mockResolvedValueOnce(json(503, { code: "sar_capture_unavailable" })));
    const { putSarTeam } = await import("@/lib/avserv/sar-teams");
    expect(await putSarTeam(NODE, body)).toMatchObject({ code: "revision_conflict", retryable: false });
    expect(await putSarTeam(NODE, body)).toMatchObject({ code: "sar_capture_unavailable", retryable: true });
  });

  it("returns an unreachable node as retryable with the error detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { putSarTeam } = await import("@/lib/avserv/sar-teams");
    expect(await putSarTeam(NODE, body)).toMatchObject({ ok: false, code: "unreachable", retryable: true, detail: expect.stringContaining("ECONNREFUSED") });
  });

  it("answers from the mock without the network", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { putSarTeam } = await import("@/lib/avserv/sar-teams");
    expect(await putSarTeam({ name: "mock", baseUrl: "mock://localhost" }, body)).toMatchObject({ ok: true, result: { applied: true, usable: true } });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("getSarTeam", () => {
  it("returns the node's view, null for 404, and throws on a bad response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(200, { orgId: "org-1", revision: 3, status: "leaving", usable: false, openBindings: 2, channelStatus: [] }))
        .mockResolvedValueOnce(json(404, { code: "sar_team_unknown" }))
        .mockResolvedValueOnce(json(200, { nope: true })),
    );
    const { getSarTeam } = await import("@/lib/avserv/sar-teams");
    expect(await getSarTeam(NODE, "org-1")).toMatchObject({ openBindings: 2 });
    expect(await getSarTeam(NODE, "org-1")).toBeNull();
    await expect(getSarTeam(NODE, "org-1")).rejects.toThrow(/schema validation/);
  });
});

describe("ackSarAlert (contacts_delete_and_sar_ack.md §2)", () => {
  it("POSTs {teamId, by} under the shared alert id and returns the node's stored ack time", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ack: { at: "2026-10-05T19:00:01Z", by: "portal-user:u0" }, first: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { ackSarAlert } = await import("@/lib/avserv/sar-teams");
    expect(await ackSarAlert(NODE, "sub-1:org-1", { teamId: "org-1", by: "portal-user:u1" })).toEqual({ ok: true, first: false, at: "2026-10-05T19:00:01Z" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://avserv-2.example/v1/internal/sar-alerts/sub-1%3Aorg-1/ack");
    expect(JSON.parse(init.body)).toEqual({ teamId: "org-1", by: "portal-user:u1" });
  });

  it("maps sar_alert_unknown and an unreachable node to failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(404, { code: "sar_alert_unknown" })).mockRejectedValueOnce(new Error("down")));
    const { ackSarAlert } = await import("@/lib/avserv/sar-teams");
    expect(await ackSarAlert(NODE, "s:t", { teamId: "t", by: "portal-user:u" })).toEqual({ ok: false, status: 404, code: "sar_alert_unknown" });
    expect(await ackSarAlert(NODE, "s:t", { teamId: "t", by: "portal-user:u" })).toMatchObject({ ok: false, code: "unreachable" });
  });
});
