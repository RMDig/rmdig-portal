import { beforeEach, describe, expect, it, vi } from "vitest";

// createDrillAvServAccount (plan 37 §4.11, P7b): a drill login's or drill
// user's AvServ account, made before the portal row. Every AvServ refusal is
// a message for the form, never an account across the line.

const h = vi.hoisted(() => {
  class AvServError extends Error {
    constructor(message: string, readonly status?: number, readonly code?: string) {
      super(message);
    }
  }
  return { AvServError, find: vi.fn(), problem: vi.fn(), error: vi.fn() };
});
vi.mock("@/lib/avserv/client", () => ({ AvServError: h.AvServError, findOrCreateAccount: h.find }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: h.error }));

import { createDrillAvServAccount, REAL_ACCOUNT_AT_ADDRESS } from "@/lib/sar/drill-avserv-account";

const EMAIL = "dennys+drill2@rmdig.ai";
const CTX = { userId: "admin-1", orgId: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.find.mockResolvedValue({ accountId: "acct-1", created: true, drill: true });
});

describe("createDrillAvServAccount", () => {
  it("asks AvServ for a drill account and returns its id", async () => {
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: true, accountId: "acct-1" });
    expect(h.find).toHaveBeenCalledWith(EMAIL, { drill: true });
  });

  it("reuses an existing drill account at the address", async () => {
    h.find.mockResolvedValue({ accountId: "acct-0", created: false, drill: true });
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: true, accountId: "acct-0" });
  });

  it("refuses a real account at the address, on the address field", async () => {
    h.find.mockRejectedValue(new h.AvServError("409", 409, "account_drill_immutable"));
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: false, error: REAL_ACCOUNT_AT_ADDRESS, field: "email" });
    expect(h.problem).toHaveBeenCalledWith("sar.drill.account_refused", expect.any(String), { ...CTX, code: "account_drill_immutable" }, "warning");
  });

  it("never keeps a real account AvServ answered with, and reports it", async () => {
    h.find.mockResolvedValue({ accountId: "acct-real", created: false, drill: false });
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: false, error: REAL_ACCOUNT_AT_ADDRESS, field: "email" });
    expect(h.problem).toHaveBeenCalledWith("sar.drill.account_not_drill", expect.any(String), { ...CTX, accountId: "acct-real" });
  });

  it("says when a node can't store drill accounts yet", async () => {
    h.find.mockRejectedValue(new h.AvServError("503", 503, "drill_support_pending"));
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: false, error: expect.stringContaining("every server yet") });
  });

  it("names the missing scope on a 403, and reports it", async () => {
    h.find.mockRejectedValue(new h.AvServError("403", 403, "path_not_allowed"));
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: false, error: expect.stringContaining("drill_accounts scope") });
    expect(h.error).toHaveBeenCalledWith("sar.drill.account_failed", expect.any(h.AvServError), CTX);
  });

  it("fails loud on anything else", async () => {
    h.find.mockRejectedValue(new Error("network down"));
    expect(await createDrillAvServAccount(EMAIL, CTX)).toEqual({ ok: false, error: "Couldn't create the drill account on AvAI. Try again in a moment." });
    expect(h.error).toHaveBeenCalledWith("sar.drill.account_failed", expect.any(Error), CTX);
  });
});
