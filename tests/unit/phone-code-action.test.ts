import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rlAllowed: true,
  rlKeys: [] as string[],
  start: vi.fn(() => Promise.resolve()),
  check: vi.fn(() => Promise.resolve(true)),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() });
  },
}));
vi.mock("@/lib/phone/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/phone/verify")>();
  return { ...real, startPhoneVerification: h.start, checkPhoneVerification: h.check };
});
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_SECRET: "a".repeat(64) } }));

import { auth } from "@/lib/auth";
import { PhoneVerifyError } from "@/lib/phone/verify";

import { sendPhoneCodeAction, verifyPhoneCodeAction } from "@/app/(portal)/phone-verify-actions";
import { verifyPhoneProof } from "@/lib/phone/proof";

const authMock = vi.mocked(auth);

function fd(phone: string): FormData {
  const f = new FormData();
  f.set("phone", phone);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rlAllowed = true;
  h.rlKeys = [];
  h.start.mockResolvedValue(undefined);
  h.check.mockResolvedValue(true);
  authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
});

describe("sendPhoneCodeAction", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await sendPhoneCodeAction(null, fd("(720) 780-9044"));
    expect(res.ok).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("rejects a non-US phone before any send", async () => {
    const res = await sendPhoneCodeAction(null, fd("12345"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/valid US phone/i);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("keys limits on both the user and the normalized phone", async () => {
    await sendPhoneCodeAction(null, fd("(720) 780-9044"));
    expect(h.rlKeys).toContain("otp-user:user-1");
    expect(h.rlKeys).toContain("otp-phone:+17207809044");
  });

  it("fails loud when rate-limited, without sending", async () => {
    h.rlAllowed = false;
    const res = await sendPhoneCodeAction(null, fd("(720) 780-9044"));
    expect(res.ok).toBe(false);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalled();
  });

  it("sends the OTP and confirms", async () => {
    const res = await sendPhoneCodeAction(null, fd("720-780-9044"));
    expect(res.ok).toBe(true);
    expect(h.start).toHaveBeenCalledWith("+17207809044");
  });

  it("surfaces a Twilio failure as a user-visible error, logged", async () => {
    h.start.mockRejectedValueOnce(new PhoneVerifyError("HTTP 429"));
    const res = await sendPhoneCodeAction(null, fd("(720) 780-9044"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/couldn't send/i);
    expect(h.log.error).toHaveBeenCalled();
  });
});

function checkFd(phone: string, code: string): FormData {
  const f = new FormData();
  f.set("phone", phone);
  f.set("code", code);
  return f;
}

describe("verifyPhoneCodeAction", () => {
  it("rejects an unauthenticated caller without asking Twilio", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await verifyPhoneCodeAction(null, checkFd("(720) 780-9044", "123456"));
    expect(res.ok).toBe(false);
    expect(h.check).not.toHaveBeenCalled();
  });

  it("rejects a missing code or a non-US phone before any check", async () => {
    expect((await verifyPhoneCodeAction(null, checkFd("(720) 780-9044", "  "))).ok).toBe(false);
    expect((await verifyPhoneCodeAction(null, checkFd("12345", "123456"))).ok).toBe(false);
    expect(h.check).not.toHaveBeenCalled();
  });

  it("returns a proof for this user and number when Twilio approves", async () => {
    const res = await verifyPhoneCodeAction(null, checkFd("720-780-9044", " 123456 "));
    expect(h.check).toHaveBeenCalledWith("+17207809044", "123456");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.phone).toBe("+17207809044");
      expect(verifyPhoneProof(res.proof, "user-1", "+17207809044")).toBe(true);
      expect(verifyPhoneProof(res.proof, "user-2", "+17207809044")).toBe(false);
    }
  });

  it("says so when the code is wrong or expired, with no proof", async () => {
    h.check.mockResolvedValueOnce(false);
    const res = await verifyPhoneCodeAction(null, checkFd("(720) 780-9044", "000000"));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/didn't match|expired/i) });
  });

  it("is rate limited per user, without asking Twilio", async () => {
    h.rlAllowed = false;
    const res = await verifyPhoneCodeAction(null, checkFd("(720) 780-9044", "123456"));
    expect(res.ok).toBe(false);
    expect(h.rlKeys).toContain("otp-check:user-1");
    expect(h.check).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalled();
  });

  it("surfaces a Twilio failure as a user-visible error, logged", async () => {
    h.check.mockRejectedValueOnce(new PhoneVerifyError("HTTP 500"));
    const res = await verifyPhoneCodeAction(null, checkFd("(720) 780-9044", "123456"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/couldn't check/i);
    expect(h.log.error).toHaveBeenCalled();
  });
});
