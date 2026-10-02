import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptBody } from "@/lib/avserv/agreement";

// Real-path (non-mock) onboarding client: what goes on the wire and how every
// AvServ answer is surfaced (contract account_agreement.md rev 2 §4). fetch is
// stubbed and the service-JWT signer mocked — no network or key needed.

vi.mock("@/lib/avserv/service-jwt", () => ({
  signServiceJwt: vi.fn().mockResolvedValue("test.service.jwt"),
}));

const ACCOUNT = "11111111-1111-5111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

const ACCOUNT_BODY = {
  accountId: ACCOUNT,
  identityVersion: 3,
  legalName: "Jane Q. Public",
  displayName: "Jane",
  email: "jane@example.com",
  emailVerified: true,
  activated: false,
  activatedAt: null,
  acceptances: [],
  agreement: { currentVersion: "v1", needsAcceptance: true, required: false },
};

const BODY: AcceptBody = {
  version: "v1",
  contentHash: "a".repeat(64),
  identity: { legalName: "Jane Q. Public", displayName: "Jane" },
  assent: { method: "checkbox_and_button", textHash: "b".repeat(64), presentedInFull: true },
  attestations: [{ id: "age_18_plus", textHash: "c".repeat(64), value: true }],
  client: { ip: "203.0.113.9", userAgent: "Mozilla/5.0", locale: "en-US" },
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

describe("getAccount", () => {
  it("GETs the account and parses the §3.1 body", async () => {
    fetchMock.mockResolvedValue(json(200, ACCOUNT_BODY));
    const { getAccount } = await import("@/lib/avserv/agreement");

    await expect(getAccount(ACCOUNT)).resolves.toEqual(ACCOUNT_BODY);
    expect(call(0).url).toBe(`https://primary.example/v1/internal/accounts/${ACCOUNT}`);
    expect(call(0).init.method).toBe("GET");
  });

  it("refuses a drifted body loudly", async () => {
    fetchMock.mockResolvedValue(json(200, { ...ACCOUNT_BODY, agreement: { currentVersion: "v1" } }));
    const { getAccount } = await import("@/lib/avserv/agreement");

    await expect(getAccount(ACCOUNT)).rejects.toThrow(/schema validation/);
  });

  it("carries AvServ's code and detail on a refusal", async () => {
    fetchMock.mockResolvedValue(
      json(404, { code: "agreement_capture_disabled", error: "account onboarding is not enabled" }),
    );
    const { getAccount } = await import("@/lib/avserv/agreement");

    await expect(getAccount(ACCOUNT)).rejects.toMatchObject({
      status: 404,
      code: "agreement_capture_disabled",
      detail: "account onboarding is not enabled",
      viaFailover: false,
    });
  });
});

describe("putIdentity", () => {
  it("PUTs only the names, never an email", async () => {
    fetchMock.mockResolvedValue(json(200, ACCOUNT_BODY));
    const { putIdentity } = await import("@/lib/avserv/agreement");

    await putIdentity(ACCOUNT, { legalName: "Jane Q. Public" });

    const { url, init } = call(0);
    expect(url).toBe(`https://primary.example/v1/internal/accounts/${ACCOUNT}/identity`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ legalName: "Jane Q. Public" });
  });
});

describe("acceptAgreement", () => {
  it("POSTs the body with the Idempotency-Key and the browser's IP and UA", async () => {
    fetchMock.mockResolvedValue(
      json(200, { acceptanceId: KEY, version: "v1", activated: true, activatedAt: "2026-10-01T00:00:00Z" }),
    );
    const { acceptAgreement } = await import("@/lib/avserv/agreement");

    const res = await acceptAgreement(ACCOUNT, KEY, BODY);

    expect(res.activated).toBe(true);
    const { url, init } = call(0);
    expect(url).toBe(`https://primary.example/v1/internal/accounts/${ACCOUNT}/agreement-acceptances`);
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(KEY);
    const sent = JSON.parse(init.body as string) as AcceptBody;
    expect(sent.client).toEqual({ ip: "203.0.113.9", userAgent: "Mozilla/5.0", locale: "en-US" });
    expect(sent.assent.presentedInFull).toBe(true);
    expect(sent.identity).not.toHaveProperty("email");
  });

  it("retries the SAME key on the failover node when the primary is unreachable", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(json(200, { acceptanceId: KEY, version: "v1", activated: true, activatedAt: null }));
    const { acceptAgreement } = await import("@/lib/avserv/agreement");

    await acceptAgreement(ACCOUNT, KEY, BODY);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(1).url).toMatch(/^https:\/\/failover\.example\//);
    const keys = [0, 1].map((i) => (call(i).init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys).toEqual([KEY, KEY]);
  });

  it("retries on a 503 and marks a failover account_not_found as lag", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock
      .mockResolvedValueOnce(json(503, { code: "agreement_capture_unavailable" }))
      .mockResolvedValueOnce(json(404, { code: "account_not_found" }));
    const { acceptAgreement } = await import("@/lib/avserv/agreement");

    await expect(acceptAgreement(ACCOUNT, KEY, BODY)).rejects.toMatchObject({
      code: "account_not_found",
      viaFailover: true,
    });
  });

  it("does not fail over on a definite refusal", async () => {
    process.env.AVSERV_FAILOVER_BASE_URL = "https://failover.example";
    fetchMock.mockResolvedValue(json(409, { code: "agreement_hash_mismatch" }));
    const { acceptAgreement } = await import("@/lib/avserv/agreement");

    await expect(acceptAgreement(ACCOUNT, KEY, BODY)).rejects.toMatchObject({
      status: 409,
      code: "agreement_hash_mismatch",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a network failure with no status when there is no failover node", async () => {
    fetchMock.mockRejectedValue(new Error("ETIMEDOUT"));
    const { acceptAgreement } = await import("@/lib/avserv/agreement");

    await expect(acceptAgreement(ACCOUNT, KEY, BODY)).rejects.toMatchObject({ status: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
