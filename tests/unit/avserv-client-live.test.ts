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

  it("mints a link code on the failover node when the primary times out", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("The operation was aborted due to timeout"))
      .mockResolvedValueOnce(jsonResponse(201, { code: "ABCD-1234", expiresAt: "2026-10-03T12:10:00Z" }));
    vi.stubGlobal("fetch", fetchMock);
    const { mintLinkCode } = await import("@/lib/avserv/client");

    await expect(mintLinkCode(ACCOUNT)).resolves.toMatchObject({ code: "ABCD-1234" });
    expect(urls(fetchMock)).toEqual([
      `https://avserv.example/v1/internal/accounts/${ACCOUNT}/link-codes`,
      `https://avserv-3.example/v1/internal/accounts/${ACCOUNT}/link-codes`,
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

  it("reports a 429 with its Retry-After and never asks the other node", async () => {
    const res = jsonResponse(429, { code: "rate_limited", error: "too many link codes" });
    res.headers.set("retry-after", "7200");
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal("fetch", fetchMock);
    const { mintLinkCode } = await import("@/lib/avserv/client");

    await expect(mintLinkCode(ACCOUNT)).rejects.toMatchObject({
      name: "AvServRateLimitedError",
      status: 429,
      retryAfterSec: 7200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail over on a 4xx from the primary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: "account not found" }));
    vi.stubGlobal("fetch", fetchMock);
    const { mintLinkCode } = await import("@/lib/avserv/client");

    await expect(mintLinkCode(ACCOUNT)).rejects.toMatchObject({ status: 404 });
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
    const { mintLinkCode, AvServError } = await import("@/lib/avserv/client");

    const err = await mintLinkCode(ACCOUNT).catch((e: unknown) => e);
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

describe("unpublishCreative (real path)", () => {
  it("treats AvServ's creative_not_found as already unpublished", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { code: "creative_not_found", error: "no such creative" })));
    const { unpublishCreative } = await import("@/lib/avserv/client");
    await expect(unpublishCreative("crv_1")).resolves.toBeUndefined();
  });

  it("fails loud on a 404 without that code: the route itself is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("404 page not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const { unpublishCreative } = await import("@/lib/avserv/client");
    await expect(unpublishCreative("crv_1")).rejects.toMatchObject({ status: 404, code: "route_not_found" });
  });
});
