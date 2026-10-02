import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  checkResult: Promise.resolve(true),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/phone/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/phone/verify")>();
  return {
    ...real, // keep the real normalizeUsPhone — the gate depends on its semantics
    phoneVerificationEnabled: () => h.enabled,
    checkPhoneVerification: () => h.checkResult,
  };
});
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { isUniqueViolation } from "@/lib/db/errors";
import { requireVerifiedOrgPhone } from "@/lib/phone/org-phone";

beforeEach(() => {
  vi.clearAllMocks();
  h.enabled = true;
  h.checkResult = Promise.resolve(true);
});

describe("requireVerifiedOrgPhone", () => {
  it("passes the raw phone through untouched when verification is disabled", async () => {
    h.enabled = false;
    expect(await requireVerifiedOrgPhone("whatever", undefined)).toEqual({
      ok: true,
      phone: "whatever",
    });
    expect(await requireVerifiedOrgPhone(undefined, undefined)).toEqual({
      ok: true,
      phone: null,
    });
  });

  it("requires a valid US phone when enabled", async () => {
    const res = await requireVerifiedOrgPhone("12345", "123456");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors.contactPhone).toBeTruthy();
  });

  it("requires the code when enabled", async () => {
    const res = await requireVerifiedOrgPhone("(720) 780-9044", "  ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors.phoneCode).toBeTruthy();
  });

  it("rejects a wrong code as a phoneCode field error", async () => {
    h.checkResult = Promise.resolve(false);
    const res = await requireVerifiedOrgPhone("(720) 780-9044", "000000");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors.phoneCode?.[0]).toMatch(/didn't match|expired/i);
  });

  it("returns the normalized E.164 number on approval", async () => {
    const res = await requireVerifiedOrgPhone("(720) 780-9044", "123456");
    expect(res).toEqual({ ok: true, phone: "+17207809044" });
  });

  it("fails loud (logged, user-visible) when the verify API errors", async () => {
    h.checkResult = Promise.reject(new Error("twilio down"));
    const res = await requireVerifiedOrgPhone("(720) 780-9044", "123456");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/couldn't verify/i);
    expect(h.log.error).toHaveBeenCalled();
  });
});

describe("isUniqueViolation", () => {
  it("matches SQLSTATE 23505 on the error or its cause", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
