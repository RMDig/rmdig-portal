import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The contacts S2S read (plan 05 P-B4, AvServ plan 63 A10): what goes on the
// wire, paging, failover, and how AvServ's answers surface. fetch is stubbed
// and the service-JWT signer mocked.

vi.mock("@/lib/avserv/service-jwt", () => ({
  signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt"),
}));

const ACCOUNT = "11111111-1111-5111-8111-111111111111";

const ROW = {
  contactId: "c-1",
  name: "Jane",
  phoneLast4: "0101",
  hasEmail: true,
  acceptance: "accepted",
  acceptedAt: "2026-10-28T15:04:05Z",
  lastIntroAt: "2026-10-28T14:58:00Z",
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

function url(i: number): URL {
  return new URL((fetchMock.mock.calls[i] as [string])[0]);
}

describe("listContacts", () => {
  it("GETs the account-scoped list at the max page size", async () => {
    fetchMock.mockResolvedValue(json(200, { contacts: [ROW] }));
    const { listContacts } = await import("@/lib/avserv/contacts");

    await expect(listContacts(ACCOUNT)).resolves.toEqual([ROW]);
    expect(url(0).pathname).toBe(`/v1/internal/accounts/${ACCOUNT}/contacts`);
    expect(url(0).searchParams.get("limit")).toBe("500");
    expect(url(0).searchParams.has("cursor")).toBe(false);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe("GET");
  });

  it("treats an account with none as an empty list", async () => {
    fetchMock.mockResolvedValue(json(200, { contacts: [] }));
    const { listContacts } = await import("@/lib/avserv/contacts");
    await expect(listContacts(ACCOUNT)).resolves.toEqual([]);
  });

  it("follows nextCursor until the last page", async () => {
    const second = { ...ROW, contactId: "c-2", acceptance: "pending", acceptedAt: null };
    fetchMock
      .mockResolvedValueOnce(json(200, { contacts: [ROW], nextCursor: "c-1" }))
      .mockResolvedValueOnce(json(200, { contacts: [second] }));
    const { listContacts } = await import("@/lib/avserv/contacts");

    await expect(listContacts(ACCOUNT)).resolves.toEqual([ROW, second]);
    expect(url(1).searchParams.get("cursor")).toBe("c-1");
  });

  it("fails loud on a cursor that does not advance", async () => {
    fetchMock.mockImplementation(async () => json(200, { contacts: [ROW], nextCursor: "c-1" }));
    const { listContacts } = await import("@/lib/avserv/contacts");
    await expect(listContacts(ACCOUNT)).rejects.toThrow(/cursor did not advance/);
  });

  it("parses an acceptance state it doesn't know rather than failing the page", async () => {
    fetchMock.mockResolvedValue(json(200, { contacts: [{ ...ROW, acceptance: "paused" }] }));
    const { listContacts } = await import("@/lib/avserv/contacts");
    await expect(listContacts(ACCOUNT)).resolves.toMatchObject([{ acceptance: "paused" }]);
  });

  it("refuses a drifted row loudly (full phone instead of last4 field)", async () => {
    const { phoneLast4: _omit, ...rest } = ROW;
    fetchMock.mockResolvedValue(json(200, { contacts: [{ ...rest, phone: "+13035550101" }] }));
    const { listContacts } = await import("@/lib/avserv/contacts");
    await expect(listContacts(ACCOUNT)).rejects.toThrow(/schema validation/);
  });

  it("carries account_not_found with its code", async () => {
    fetchMock.mockResolvedValue(json(404, { code: "account_not_found", error: "account not found" }));
    const { listContacts } = await import("@/lib/avserv/contacts");
    await expect(listContacts(ACCOUNT)).rejects.toMatchObject({ status: 404, code: "account_not_found" });
  });

  it("asks the failover node when the primary answers 503", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock
      .mockResolvedValueOnce(json(503, { error: "service tier not configured" }))
      .mockResolvedValueOnce(json(200, { contacts: [ROW] }));
    const { listContacts } = await import("@/lib/avserv/contacts");

    await expect(listContacts(ACCOUNT)).resolves.toEqual([ROW]);
    expect(url(1).host).toBe("failover.example");
  });

  it("serves the mock without a network call under mock://", async () => {
    process.env.AVSERV_BASE_URL = "mock://localhost";
    const { listContacts } = await import("@/lib/avserv/contacts");

    const contacts = await listContacts(ACCOUNT);
    expect(contacts.map((c) => c.acceptance)).toEqual(["accepted", "pending"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
