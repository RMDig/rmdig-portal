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
  delete process.env.AVSERV_NODE_URLS;
});

describe("avservNodes", () => {
  it("lists every node in AVSERV_NODE_URLS by host, in order", async () => {
    process.env.AVSERV_NODE_URLS = "https://avserv-2.example, https://avserv-3.example/";
    const { avservNodes } = await import("@/lib/avserv/sar-teams");
    expect(avservNodes()).toEqual([
      { name: "avserv-2.example", baseUrl: "https://avserv-2.example" },
      { name: "avserv-3.example", baseUrl: "https://avserv-3.example" },
    ]);
  });

  it("is no nodes when unset, never a guess from the account URLs", async () => {
    delete process.env.AVSERV_NODE_URLS;
    const { avservNodes } = await import("@/lib/avserv/sar-teams");
    expect(avservNodes()).toEqual([]);
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

  // sar_team_sync.md §2 and §5.5 (R4c): each channel kind has its own shape.
  // An email bounce must not fail the read Withdraw and the checks rely on.
  const view = (channelStatus: unknown[]) => json(200, { orgId: "org-1", revision: 5, status: "approved", usable: true, openBindings: 0, channelStatus });

  it("reads an email channel's bounce or complaint, an SMS channel's STOP, and a clean email channel", async () => {
    const channels = [
      { kind: "email", bouncedAt: "2026-11-11T03:00:00Z" },
      { kind: "email", complainedAt: "2026-11-11T04:00:00Z" },
      { kind: "email" },
      { kind: "sms", phone: "+13035550100", optedOutAt: "2026-11-10T12:00:00Z", source: "stop_text" },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(view(channels)));
    const { getSarTeam } = await import("@/lib/avserv/sar-teams");
    expect((await getSarTeam(NODE, "org-1"))?.channelStatus).toEqual(channels);
  });

  it("keeps a channel kind it doesn't know yet by name, without failing the read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(view([{ kind: "pager", whatever: 1 }])));
    const { getSarTeam } = await import("@/lib/avserv/sar-teams");
    expect((await getSarTeam(NODE, "org-1"))?.channelStatus).toEqual([{ kind: "pager" }]);
  });

  it("still refuses a malformed SMS or email entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(view([{ kind: "sms", phone: "+13035550100" }])).mockResolvedValueOnce(view([{ kind: "email", bouncedAt: 7 }])),
    );
    const { getSarTeam } = await import("@/lib/avserv/sar-teams");
    await expect(getSarTeam(NODE, "org-1")).rejects.toThrow(/schema validation/);
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
