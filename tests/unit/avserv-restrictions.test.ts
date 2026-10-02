import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The restrictions S2S client (AvServ contract restrictions.md rev 1): what
// goes on the wire, the failover rule, and how AvServ's answers surface. fetch
// is stubbed and the service-JWT signer mocked.

vi.mock("@/lib/avserv/service-jwt", () => ({
  signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt"),
}));

const ACCOUNT = "11111111-1111-5111-8111-111111111111";
const RESTRICTION = "33333333-3333-4333-8333-333333333333";

const ROW = {
  id: RESTRICTION,
  accountId: ACCOUNT,
  scope: "incident_detection",
  state: "active",
  reasonCode: "incident_abuse",
  userReason: "Paused after a review of recent automatic alerts.",
  operatorNote: "7 suspects in 24 h",
  issuedBy: "operator:denny",
  issuedAt: "2026-09-28T16:00:00Z",
  activatedAt: "2026-09-28T18:30:00Z",
  liftedAt: null,
  liftNote: null,
  liftedBy: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.AVSERV_BASE_URL = "https://primary.example";
  delete process.env.AVSERV_FAILOVER_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(i: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init };
}

describe("listRestrictions", () => {
  it("GETs the account-scoped list and parses §1 objects", async () => {
    fetchMock.mockResolvedValue(json(200, { restrictions: [ROW] }));
    const { listRestrictions } = await import("@/lib/avserv/restrictions");

    await expect(listRestrictions(ACCOUNT)).resolves.toEqual([ROW]);
    expect(call(0).url).toBe(`https://primary.example/v1/internal/accounts/${ACCOUNT}/restrictions`);
    expect(call(0).init.method).toBe("GET");
  });

  it("treats an account with none as an empty list", async () => {
    fetchMock.mockResolvedValue(json(200, { restrictions: [] }));
    const { listRestrictions } = await import("@/lib/avserv/restrictions");
    await expect(listRestrictions(ACCOUNT)).resolves.toEqual([]);
  });

  it("refuses a drifted row loudly (bad actor string)", async () => {
    fetchMock.mockResolvedValue(json(200, { restrictions: [{ ...ROW, issuedBy: "denny" }] }));
    const { listRestrictions } = await import("@/lib/avserv/restrictions");
    await expect(listRestrictions(ACCOUNT)).rejects.toThrow(/schema validation/);
  });

  it("carries account_not_found with its code", async () => {
    fetchMock.mockResolvedValue(json(404, { code: "account_not_found", error: "no such account" }));
    const { listRestrictions } = await import("@/lib/avserv/restrictions");
    await expect(listRestrictions(ACCOUNT)).rejects.toMatchObject({ status: 404, code: "account_not_found" });
  });
});

describe("liftRestriction", () => {
  const lifted = { ...ROW, state: "lifted", liftedAt: "2026-10-01T12:00:00Z", liftNote: "ok", liftedBy: "portal:u1" };

  it("POSTs {note, liftedBy} to the account-scoped lift route", async () => {
    fetchMock.mockResolvedValue(json(200, lifted));
    const { liftRestriction } = await import("@/lib/avserv/restrictions");

    await expect(liftRestriction(ACCOUNT, RESTRICTION, { note: "ok", liftedBy: "portal:u1" })).resolves.toEqual(lifted);
    const { url, init } = call(0);
    expect(url).toBe(`https://primary.example/v1/internal/accounts/${ACCOUNT}/restrictions/${RESTRICTION}/lift`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ note: "ok", liftedBy: "portal:u1" });
  });

  it("asks the other node after a 404 restriction_not_found (replication lag)", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock
      .mockResolvedValueOnce(json(404, { code: "restriction_not_found" }))
      .mockResolvedValueOnce(json(200, lifted));
    const { liftRestriction } = await import("@/lib/avserv/restrictions");

    await liftRestriction(ACCOUNT, RESTRICTION, { note: "ok", liftedBy: "portal:u1" });
    expect(call(1).url).toMatch(/^https:\/\/failover\.example\//);
    expect(call(1).init.body).toBe(call(0).init.body);
  });

  it("asks the other node after restrictions_unavailable (503)", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock
      .mockResolvedValueOnce(json(503, { code: "restrictions_unavailable", error: "peer upgrading" }))
      .mockResolvedValueOnce(json(200, lifted));
    const { liftRestriction } = await import("@/lib/avserv/restrictions");

    await expect(liftRestriction(ACCOUNT, RESTRICTION, { note: "ok", liftedBy: "portal:u1" })).resolves.toEqual(lifted);
  });

  it("does not fail over on a definite refusal", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock.mockResolvedValue(json(400, { code: "invalid_note", error: "note too long" }));
    const { liftRestriction } = await import("@/lib/avserv/restrictions");

    await expect(liftRestriction(ACCOUNT, RESTRICTION, { note: "x", liftedBy: "portal:u1" })).rejects.toMatchObject({
      code: "invalid_note",
      detail: "note too long",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
