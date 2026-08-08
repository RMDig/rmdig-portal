import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rlAllowed: true,
  rlKeys: [] as string[],
  start: vi.fn(() => Promise.resolve()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() });
  },
}));
vi.mock("@/lib/phone/verify", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/phone/verify")>();
  return { ...real, startPhoneVerification: h.start };
});
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { auth } from "@/lib/auth";
import { PhoneVerifyError } from "@/lib/phone/verify";

import { sendPhoneCodeAction } from "@/app/(portal)/phone-verify-actions";

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
