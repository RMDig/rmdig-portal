import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  enabled: true,
  checkResult: Promise.resolve(true),
  check: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/phone/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/phone/verify")>();
  return {
    ...real, // keep the real normalizeUsPhone — the gate depends on its semantics
    phoneVerificationEnabled: () => h.enabled,
    checkPhoneVerification: (...args: unknown[]) => {
      h.check(...args);
      return h.checkResult;
    },
  };
});
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_SECRET: "a".repeat(64) } }));

import { isUniqueViolation } from "@/lib/db/errors";
import { requireVerifiedOrgPhone } from "@/lib/phone/org-phone";
import { signPhoneProof } from "@/lib/phone/proof";

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

describe("requireVerifiedOrgPhone with a proof from the Verify step", () => {
  const PHONE = "+17207809044";

  it("accepts a valid proof without a code and without asking Twilio again", async () => {
    const token = signPhoneProof("user-1", PHONE);
    const res = await requireVerifiedOrgPhone("(720) 780-9044", undefined, { token, userId: "user-1" });
    expect(res).toEqual({ ok: true, phone: PHONE });
    expect(h.check).not.toHaveBeenCalled();
  });

  it("refuses a proof issued to another user, falling back to the code", async () => {
    const token = signPhoneProof("user-2", PHONE);
    const res = await requireVerifiedOrgPhone("(720) 780-9044", "123456", { token, userId: "user-1" });
    expect(res).toEqual({ ok: true, phone: PHONE });
    expect(h.check).toHaveBeenCalledWith(PHONE, "123456");
  });

  it("refuses a proof for a different number than the one submitted", async () => {
    const token = signPhoneProof("user-1", "+17205550100");
    const res = await requireVerifiedOrgPhone("(720) 780-9044", undefined, { token, userId: "user-1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors.phoneCode?.[0]).toMatch(/expired/i);
  });

  it("asks for a fresh verification when an expired proof comes without a code", async () => {
    const token = signPhoneProof("user-1", PHONE, Date.now() - 2 * 60 * 60 * 1000);
    const res = await requireVerifiedOrgPhone("(720) 780-9044", "", { token, userId: "user-1" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors.phoneCode?.[0]).toMatch(/verify again/i);
    expect(h.check).not.toHaveBeenCalled();
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
