import { beforeEach, describe, expect, it, vi } from "vitest";

// The operator's "Erase in AvServ" actions: who may run them, and that the
// erase is never sent unless every guard holds and every node is ready.

const ACCT = "22222222-2222-4222-8222-222222222222";
const REQ = "11111111-1111-4111-8111-111111111111";
const CONFIRMED = new Date("2026-10-27T12:00:00.000Z");

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "staff-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  mfa: true,
  recent: true,
  available: true,
  allowed: true,
  request: [] as unknown[],
  preview: vi.fn(),
  erase: vi.fn(),
  status: vi.fn(),
  limit: vi.fn(),
  sentry: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/auth/passkeys", () => ({ mfaIsOn: () => Promise.resolve(h.mfa) }));
vi.mock("@/lib/auth/recent-auth", () => ({
  requireRecentAuth: () => Promise.resolve(h.recent ? { ok: true, sessionId: "s", authMethod: "password", authPasskeyId: null } : { ok: false, reauth: true }),
}));
vi.mock("@/lib/avserv/erasure", () => ({
  erasureAvailable: () => h.available,
  previewErasureEveryNode: h.preview,
  eraseOnPrimary: h.erase,
  erasureStatusEveryNode: h.status,
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (...a: unknown[]) => {
    h.limit(...a);
    return Promise.resolve({ allowed: h.allowed, attempts: 1, resetAt: new Date() });
  },
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentry, captureException: vi.fn() }));
vi.mock("@/lib/db", () => {
  const select = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = () => Promise.resolve(h.request);
    return c;
  };
  return { db: { select } };
});

import { eraseAccountAction, erasureStatusAction, previewErasureAction } from "@/app/(portal)/admin/deletion-requests/erasure-actions";

const fd = (o: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("requestId", REQ);
  f.set("accountId", ACCT);
  f.set("confirmAccountId", ACCT);
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const ready = (node: string) => ({ node, ok: true, value: { accountId: ACCT, node, alreadyErased: false, erasable: true, live: [] } });
const record = (node: string) => ({
  accountId: ACCT,
  alreadyErased: false,
  requestRef: REQ,
  evidence: "tombstone",
  originNode: node,
  requestedAt: "2026-10-28T17:00:00Z",
  appliedAt: "2026-10-28T17:00:01Z",
  rows: { accounts: 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(h, { actor: { ok: true, userId: "staff-1" }, admin: true, mfa: true, recent: true, available: true, allowed: true });
  h.request = [{ email: "a@example.com", confirmedAt: CONFIRMED }];
  h.preview.mockResolvedValue([ready("avserv-2"), ready("avserv-3")]);
  h.erase.mockResolvedValue({ node: "avserv-2", ok: true, value: record("avserv-2") });
  h.status.mockResolvedValue([
    { node: "avserv-2", ok: true, value: { ...record("avserv-2"), alreadyErased: true } },
    { node: "avserv-3", ok: true, value: { ...record("avserv-2"), alreadyErased: true } },
  ]);
});

describe("guards (every action)", () => {
  it.each([
    ["signed out", () => (h.actor = { ok: false, error: "You must be signed in." }), /signed in/],
    ["not an rmdig admin", () => (h.admin = false), /platform administrator/],
    ["no erasure key", () => (h.available = false), /isn't set up/],
    ["no two-factor", () => (h.mfa = false), /two-factor/],
    ["request not in the confirmed queue", () => (h.request = []), /confirmed queue/],
  ])("refuses when %s, and calls AvServ for nothing", async (_name, arrange, message) => {
    arrange();
    for (const action of [previewErasureAction, eraseAccountAction, erasureStatusAction]) {
      const r = await action(null, fd());
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(message) });
    }
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.erase).not.toHaveBeenCalled();
    expect(h.status).not.toHaveBeenCalled();
  });

  it("asks for a fresh login when the last one is old", async () => {
    h.recent = false;
    expect(await eraseAccountAction(null, fd())).toMatchObject({ ok: false, reauth: true });
    expect(h.erase).not.toHaveBeenCalled();
  });

  it("rejects an account id that isn't a UUID", async () => {
    expect(await previewErasureAction(null, fd({ accountId: "nope" }))).toMatchObject({ ok: false, error: expect.stringMatching(/UUID/) });
  });
});

describe("previewErasureAction", () => {
  it("returns every node's verdict, as the clicking admin", async () => {
    const r = await previewErasureAction(null, fd());
    expect(r).toMatchObject({ ok: true, verdict: { canErase: true } });
    expect(h.preview).toHaveBeenCalledWith(ACCT, "staff-1");
  });
});

describe("eraseAccountAction", () => {
  it("erases on the request row's values, then reads every node back", async () => {
    const r = await eraseAccountAction(null, fd());
    expect(h.erase).toHaveBeenCalledWith(ACCT, { requestRef: REQ, email: "a@example.com", confirmedAt: CONFIRMED.toISOString() }, "staff-1");
    expect(h.limit).toHaveBeenCalledWith("avserv-erasure:portal", { limit: 5, windowSec: 86400 });
    expect(r).toMatchObject({ ok: true, outcome: { kind: "erased" }, status: { overall: "erased" } });
    expect(r.ok && r.note).toMatch(/erased AvAI account/);
  });

  it("needs the account id typed again", async () => {
    expect(await eraseAccountAction(null, fd({ confirmAccountId: "33333333-3333-4333-8333-333333333333" }))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Type the account id/),
    });
    expect(h.erase).not.toHaveBeenCalled();
  });

  it("checks every node again first, and sends nothing if one isn't ready", async () => {
    h.preview.mockResolvedValue([ready("avserv-2"), { node: "avserv-3", ok: true, value: { accountId: ACCT, node: "avserv-3", alreadyErased: false, erasable: false, live: [{ kind: "checkout", id: "c1" }] } }]);
    const r = await eraseAccountAction(null, fd());
    expect(r).toMatchObject({ ok: true, outcome: { kind: "later", code: "preview_changed" }, verdict: { canErase: false } });
    expect(h.erase).not.toHaveBeenCalled();
    expect(h.limit).not.toHaveBeenCalled();
  });

  it("stops at the portal's daily limit before calling AvServ", async () => {
    h.allowed = false;
    expect(await eraseAccountAction(null, fd())).toMatchObject({ ok: false, error: expect.stringMatching(/limit of 5/) });
    expect(h.erase).not.toHaveBeenCalled();
  });

  it.each(["email_mismatch", "account_newer_than_request"])("stops loudly on %s, with no status read", async (code) => {
    h.erase.mockResolvedValue({ node: "avserv-2", ok: false, status: 409, code });
    expect(await eraseAccountAction(null, fd())).toMatchObject({ ok: true, outcome: { kind: "stop", code } });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "deletion.erasure.stop", code }));
    expect(h.sentry).toHaveBeenCalledWith(expect.stringContaining(code), expect.objectContaining({ level: "error" }));
    expect(h.status).not.toHaveBeenCalled();
  });

  it("reads every node when the erase got no answer, and never sends it again", async () => {
    h.erase.mockResolvedValue({ node: "avserv-2", ok: false, code: "unreachable" });
    const r = await eraseAccountAction(null, fd());
    expect(r).toMatchObject({ ok: true, outcome: { kind: "unknown" }, status: { overall: "erased" } });
    expect(h.erase).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "deletion.erasure.unknown" }));
  });

  it("reports a fault on our side to Sentry", async () => {
    h.erase.mockResolvedValue({ node: "avserv-2", ok: false, status: 403, code: "path_not_allowed" });
    expect(await eraseAccountAction(null, fd())).toMatchObject({ ok: true, outcome: { kind: "fault", code: "path_not_allowed" } });
    expect(h.sentry).toHaveBeenCalledWith(expect.stringContaining("path_not_allowed"), expect.objectContaining({ level: "error" }));
  });

  it("passes a blocked erase's live items back, with nothing erased", async () => {
    h.erase.mockResolvedValue({ node: "avserv-2", ok: false, status: 409, code: "erasure_blocked_active", live: [{ kind: "help_request", id: "h1" }] });
    expect(await eraseAccountAction(null, fd())).toMatchObject({ ok: true, outcome: { kind: "blocked", live: [{ kind: "help_request", id: "h1" }] } });
    expect(h.status).not.toHaveBeenCalled();
  });
});

describe("erasureStatusAction", () => {
  it("summarizes every node and drafts the note", async () => {
    const r = await erasureStatusAction(null, fd());
    expect(r).toMatchObject({ ok: true, status: { overall: "erased" } });
    expect(r.ok && r.note).toContain(ACCT);
  });
});
