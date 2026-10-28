import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real (non-mock) erasure client against stubbed nodes: the erasure key
// signs every call, preview and status go to every node, the erase goes to
// the primary only (never re-sent to the failover), and each answer is parsed
// per account_erasure.md rev 1.

const h = vi.hoisted(() => ({ roles: [] as string[], sentry: vi.fn() }));

vi.mock("@/lib/avserv/service-jwt", () => ({
  signServiceJwt: (role: string = "default") => {
    h.roles.push(role);
    return Promise.resolve(`jwt-for-${role}`);
  },
  erasureKeyConfigured: () => !!process.env.AVSERV_ERASURE_JWT_SIGNING_KEY_B64,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: h.sentry }));

const ACCT = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const record = (node: string) => ({
  accountId: ACCT,
  alreadyErased: false,
  requestRef: REQ,
  evidence: "tombstone",
  originNode: node,
  requestedAt: "2026-10-28T17:00:00Z",
  appliedAt: "2026-10-28T17:00:01Z",
  rows: { accounts: 1 },
  requestedByKid: "svc-key-portal-erasure",
  reader: "portal-user:u1",
});
const body = { requestRef: REQ, email: "a@example.com", confirmedAt: "2026-10-27T12:00:00.000Z" };

let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  vi.resetModules();
  h.roles = [];
  h.sentry.mockReset();
  calls = [];
  process.env.AVSERV_BASE_URL = "https://avserv-2.example";
  process.env.AVSERV_FAILOVER_BASE_URL = "https://avserv-3.example";
  process.env.AVSERV_ERASURE_JWT_SIGNING_KEY_B64 = "present";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AVSERV_FAILOVER_BASE_URL;
  delete process.env.AVSERV_ERASURE_JWT_SIGNING_KEY_B64;
});

function stubNodes(answer: (url: string) => Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const a = answer(url);
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    }),
  );
}

describe("erasureAvailable", () => {
  it("needs the erasure key against a real AvServ, never another key", async () => {
    const { erasureAvailable } = await import("@/lib/avserv/erasure");
    expect(erasureAvailable()).toBe(true);
    delete process.env.AVSERV_ERASURE_JWT_SIGNING_KEY_B64;
    expect(erasureAvailable()).toBe(false);
  });
});

describe("previewErasureEveryNode", () => {
  it("asks every node, as the erasure key, naming the reader", async () => {
    stubNodes((url) => json(200, { accountId: ACCT, node: new URL(url).host, alreadyErased: false, erasable: true, live: [] }));
    const { previewErasureEveryNode } = await import("@/lib/avserv/erasure");
    const answers = await previewErasureEveryNode(ACCT, "u1");
    expect(answers.map((a) => a.ok)).toEqual([true, true]);
    expect(calls.map((c) => new URL(c.url).host).sort()).toEqual(["avserv-2.example", "avserv-3.example"]);
    expect(h.roles).toEqual(["erasure", "erasure"]);
    for (const c of calls) {
      expect(c.url).toBe(`https://${new URL(c.url).host}/v1/internal/accounts/${ACCT}/erasure-preview`);
      expect(c.init.method).toBe("GET");
      expect((c.init.headers as Record<string, string>)["x-avai-reader"]).toBe("portal-user:u1");
    }
  });

  it("reports a node that didn't answer, and a drifted body loudly", async () => {
    stubNodes((url) => (url.includes("avserv-3") ? new TypeError("fetch failed") : json(200, { accountId: ACCT })));
    const { previewErasureEveryNode } = await import("@/lib/avserv/erasure");
    const answers = await previewErasureEveryNode(ACCT, "u1");
    expect(answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: "avserv-3.example", ok: false, code: "unreachable" }),
        expect.objectContaining({ node: "avserv-2.example", ok: false, code: "bad_response" }),
      ]),
    );
    expect(h.sentry).toHaveBeenCalledWith(expect.stringMatching(/schema validation/), expect.objectContaining({ level: "error" }));
  });
});

describe("eraseOnPrimary", () => {
  it("POSTs the request row's values to the primary only", async () => {
    stubNodes((url) => json(200, record(new URL(url).host)));
    const { eraseOnPrimary } = await import("@/lib/avserv/erasure");
    const answer = await eraseOnPrimary(ACCT, body, "u1");
    expect(answer).toMatchObject({ ok: true, node: "avserv-2.example" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://avserv-2.example/v1/internal/accounts/${ACCT}/erasure`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(body);
    expect(h.roles).toEqual(["erasure"]);
  });

  it("never re-sends to the failover when the primary doesn't answer", async () => {
    stubNodes(() => new TypeError("The operation was aborted due to timeout"));
    const { eraseOnPrimary } = await import("@/lib/avserv/erasure");
    expect(await eraseOnPrimary(ACCT, body, "u1")).toMatchObject({ ok: false, code: "unreachable" });
    expect(calls).toHaveLength(1);
  });

  it("carries the live items of a blocked erase, and Retry-After of a capped one", async () => {
    stubNodes(() => json(409, { code: "erasure_blocked_active", error: "live", live: [{ kind: "checkout", id: "c1" }] }));
    const { eraseOnPrimary } = await import("@/lib/avserv/erasure");
    expect(await eraseOnPrimary(ACCT, body, "u1")).toEqual({
      node: "avserv-2.example",
      ok: false,
      status: 409,
      code: "erasure_blocked_active",
      live: [{ kind: "checkout", id: "c1" }],
    });

    vi.resetModules();
    stubNodes(() => json(429, { code: "erasure_rate_limited", error: "cap" }, { "retry-after": "3600" }));
    const again = await import("@/lib/avserv/erasure");
    expect(await again.eraseOnPrimary(ACCT, body, "u1")).toMatchObject({ status: 429, code: "erasure_rate_limited", retryAfterSec: 3600 });
  });

  it("carries the stop codes as they are", async () => {
    stubNodes(() => json(409, { code: "email_mismatch", error: "not this account's" }));
    const { eraseOnPrimary } = await import("@/lib/avserv/erasure");
    expect(await eraseOnPrimary(ACCT, body, "u1")).toMatchObject({ ok: false, status: 409, code: "email_mismatch" });
  });
});

describe("erasureStatusEveryNode", () => {
  it("reads every node; a node without the record answers not_erased", async () => {
    stubNodes((url) => (url.includes("avserv-3") ? json(404, { code: "not_erased", error: "none" }) : json(200, { ...record("avserv-2"), alreadyErased: true })));
    const { erasureStatusEveryNode } = await import("@/lib/avserv/erasure");
    const answers = await erasureStatusEveryNode(ACCT, "u1");
    expect(answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: "avserv-2.example", ok: true }),
        expect.objectContaining({ node: "avserv-3.example", ok: false, status: 404, code: "not_erased" }),
      ]),
    );
    for (const c of calls) expect(c.init.method).toBe("GET");
  });
});
