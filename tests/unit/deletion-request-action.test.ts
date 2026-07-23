import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rlAllowed: true,
  inserted: [] as Array<{ table: string; vals: Record<string, unknown> }>,
  insertFails: false,
  sendConfirm: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db/schema", () => ({
  deletionRequests: { __t: "deletion_requests", id: "id" },
}));
vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: { __t: string }) => ({
      values: (vals: Record<string, unknown>) => ({
        returning: () => {
          if (h.insertFails) return Promise.reject(new Error("db down"));
          h.inserted.push({ table: table.__t, vals });
          return Promise.resolve([{ id: "req-1" }]);
        },
      }),
    }),
  },
}));
vi.mock("@/lib/email/send", () => ({
  sendDataDeletionConfirmEmail: h.sendConfirm,
}));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: () =>
    Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() }),
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { requestDataDeletionAction } from "@/app/(public)/account/delete/actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rlAllowed = true;
  h.inserted = [];
  h.insertFails = false;
});

describe("requestDataDeletionAction", () => {
  it("records a request and emails a confirmation link", async () => {
    const res = await requestDataDeletionAction(null, form({ email: "User@Rmdig.ai" }));
    expect(res).toEqual({ ok: true });
    expect(h.inserted).toHaveLength(1);
    // Email is normalized so the operator queue and rate-limit key are stable.
    expect(h.inserted[0]?.vals.email).toBe("user@rmdig.ai");
    // Only the hash is persisted; the plaintext token goes into the link.
    expect(h.inserted[0]?.vals.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.sendConfirm).toHaveBeenCalledTimes(1);
    const [to, params] = h.sendConfirm.mock.calls[0] as [
      string,
      { confirmUrl: string; expiresInHours: number },
    ];
    expect(to).toBe("user@rmdig.ai");
    expect(params.confirmUrl).toContain("/account/delete/confirm?token=");
    // The URL carries the plaintext token, never the stored hash.
    const urlToken = params.confirmUrl.split("token=")[1];
    expect(urlToken).not.toBe(h.inserted[0]?.vals.tokenHash);
  });

  it("rejects a malformed email with field errors and sends nothing", async () => {
    const res = await requestDataDeletionAction(null, form({ email: "not-an-email" }));
    expect(res?.ok).toBe(false);
    if (res?.ok === false) expect(res.fieldErrors?.email).toBeTruthy();
    expect(h.inserted).toHaveLength(0);
    expect(h.sendConfirm).not.toHaveBeenCalled();
  });

  it("stops at the rate limit without writing or emailing", async () => {
    h.rlAllowed = false;
    const res = await requestDataDeletionAction(null, form({ email: "user@rmdig.ai" }));
    expect(res?.ok).toBe(false);
    expect(h.inserted).toHaveLength(0);
    expect(h.sendConfirm).not.toHaveBeenCalled();
  });

  it("surfaces a DB failure instead of pretending success", async () => {
    h.insertFails = true;
    const res = await requestDataDeletionAction(null, form({ email: "user@rmdig.ai" }));
    expect(res?.ok).toBe(false);
    expect(h.sendConfirm).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalled();
  });

  it("surfaces an email-send failure instead of pretending success", async () => {
    h.sendConfirm.mockRejectedValueOnce(new Error("resend down"));
    const res = await requestDataDeletionAction(null, form({ email: "user@rmdig.ai" }));
    expect(res?.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalled();
  });
});
