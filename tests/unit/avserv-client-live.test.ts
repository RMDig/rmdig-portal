import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real-path (non-mock) client behaviour: the status-mapping discipline the live
// cut depends on. fetch is stubbed and the service-JWT signer is mocked so no
// network or signing key is needed — we assert how the client interprets each
// AvServ status, not the transport.

vi.mock("@/lib/avserv/service-jwt", () => ({
  signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt"),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "https://avserv.example";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listDevices (real path)", () => {
  it("parses a well-formed response, including a null appVersion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          devices: [
            {
              deviceId: "11111111-1111-5111-8111-111111111111",
              platform: "iOS",
              appVersion: "1.5.0",
              createdAt: "2026-05-20T14:30:00Z",
              lastSeenAt: "2026-06-04T09:15:00Z",
            },
            {
              deviceId: "22222222-2222-5222-8222-222222222222",
              platform: "macOS",
              appVersion: null,
              createdAt: "2026-04-02T11:00:00Z",
              lastSeenAt: "2026-05-28T18:42:00Z",
            },
          ],
        }),
      ),
    );
    const { listDevices } = await import("@/lib/avserv/client");

    const devices = await listDevices("11111111-1111-5111-8111-111111111111");
    expect(devices).toHaveLength(2);
    expect(devices[1]!.appVersion).toBeNull();
  });

  it("treats an existing account with no devices as a successful empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { devices: [] })));
    const { listDevices } = await import("@/lib/avserv/client");

    await expect(listDevices("11111111-1111-5111-8111-111111111111")).resolves.toEqual([]);
  });

  it("maps 503 (service tier unconfigured) to a distinct, diagnosable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, { error: "nope" })));
    const { listDevices, AvServError } = await import("@/lib/avserv/client");

    await expect(listDevices("acct")).rejects.toMatchObject({
      constructor: AvServError,
      status: 503,
    });
  });

  it("maps 404 to an unknown-account error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { error: "nope" })));
    const { listDevices } = await import("@/lib/avserv/client");

    await expect(listDevices("acct")).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a schema-drifted response (missing platform) loudly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          devices: [{ deviceId: "x", createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-01T00:00:00Z" }],
        }),
      ),
    );
    const { listDevices } = await import("@/lib/avserv/client");

    await expect(listDevices("acct")).rejects.toThrow(/schema/i);
  });
});

describe("client status hardening (real path)", () => {
  it("findOrCreateAccount maps 503 to status 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, {})));
    const { findOrCreateAccount } = await import("@/lib/avserv/client");
    await expect(findOrCreateAccount("a@b.com")).rejects.toMatchObject({ status: 503 });
  });

  it("mintLinkCode maps 400 (malformed account id) to status 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, {})));
    const { mintLinkCode } = await import("@/lib/avserv/client");
    await expect(mintLinkCode("acct")).rejects.toMatchObject({ status: 400 });
  });

  it("mintLinkCode maps 503 to status 503", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, {})));
    const { mintLinkCode } = await import("@/lib/avserv/client");
    await expect(mintLinkCode("acct")).rejects.toMatchObject({ status: 503 });
  });
});

// Failover for the calls that are safe to repeat on the other node (AvServ
// nodes are equal peers with replicated state). Account creation is NOT among
// them: ids are random per node, so a retry after a lost response could create
// a second account for the same email.
describe("failover to AVSERV_FAILOVER_BASE_URL (real path)", () => {
  const ACCOUNT = "11111111-1111-5111-8111-111111111111";
  const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://avserv-3.example";
  });
  afterEach(() => {
    delete process.env.AVSERV_FAILOVER_BASE_URL;
  });

  it("lists devices from the failover node when the primary times out", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("The operation was aborted due to timeout"))
      .mockResolvedValueOnce(jsonResponse(200, { devices: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { listDevices } = await import("@/lib/avserv/client");

    await expect(listDevices(ACCOUNT)).resolves.toEqual([]);
    expect(urls(fetchMock)).toEqual([
      `https://avserv.example/v1/internal/accounts/${ACCOUNT}/devices`,
      `https://avserv-3.example/v1/internal/accounts/${ACCOUNT}/devices`,
    ]);
  });

  it("mints a link code on the failover node when the primary answers 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { error: "bad gateway" }))
      .mockResolvedValueOnce(jsonResponse(201, { code: "ABCD-1234", expiresAt: "2026-10-03T12:10:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    const { mintLinkCode } = await import("@/lib/avserv/client");

    await expect(mintLinkCode(ACCOUNT)).resolves.toEqual({
      code: "ABCD-1234",
      expiresAt: "2026-10-03T12:10:00Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fail over on a 4xx from the primary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: "account not found" }));
    vi.stubGlobal("fetch", fetchMock);
    const { listDevices } = await import("@/lib/avserv/client");

    await expect(listDevices(ACCOUNT)).rejects.toThrow("AvServ does not know this account (404)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a 404 from the failover node as replication lag, not an unknown account", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse(404, { error: "account not found" }));
    vi.stubGlobal("fetch", fetchMock);
    const { mintLinkCode } = await import("@/lib/avserv/client");

    await expect(mintLinkCode(ACCOUNT)).rejects.toThrow(/replication lag/);
  });

  it("fails loud when no node answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { listDevices, AvServError } = await import("@/lib/avserv/client");

    const err = await listDevices(ACCOUNT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AvServError);
    expect((err as Error).message).toMatch(/ECONNREFUSED/);
  });

  it("keeps account creation on the primary only, even when it times out", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout"));
    vi.stubGlobal("fetch", fetchMock);
    const { findOrCreateAccount } = await import("@/lib/avserv/client");

    await expect(findOrCreateAccount("someone@example.com")).rejects.toThrow();
    expect(urls(fetchMock)).toEqual(["https://avserv.example/v1/internal/accounts"]);
  });
});
