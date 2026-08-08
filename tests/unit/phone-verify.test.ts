import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}));

vi.mock("@/lib/env", () => ({ env: h.env }));

import {
  checkPhoneVerification,
  normalizeUsPhone,
  PhoneVerifyError,
  phoneVerificationEnabled,
  startPhoneVerification,
} from "@/lib/phone/verify";

const CONFIGURED = {
  TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_AUTH_TOKEN: "token",
  TWILIO_VERIFY_SERVICE_SID: "VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
};

function mockFetch(status: number, json: Record<string, unknown>) {
  const spy = vi.fn(() =>
    Promise.resolve({ status, json: () => Promise.resolve(json) } as Response),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeUsPhone", () => {
  it("normalizes common US formats to E.164", () => {
    expect(normalizeUsPhone("(720) 780-9044")).toBe("+17207809044");
    expect(normalizeUsPhone("720-780-9044")).toBe("+17207809044");
    expect(normalizeUsPhone("17207809044")).toBe("+17207809044");
    expect(normalizeUsPhone("+1 720 780 9044")).toBe("+17207809044");
  });

  it("rejects non-NANP and malformed input", () => {
    expect(normalizeUsPhone("")).toBeNull();
    expect(normalizeUsPhone("12345")).toBeNull();
    expect(normalizeUsPhone("+44 20 7946 0958")).toBeNull(); // UK
    expect(normalizeUsPhone("(020) 780-9044")).toBeNull(); // area code starts with 0
    expect(normalizeUsPhone("(720) 180-9044")).toBeNull(); // exchange starts with 1
  });
});

describe("phoneVerificationEnabled", () => {
  it("is false unless all three env vars are set", () => {
    expect(phoneVerificationEnabled()).toBe(false);
    h.env.TWILIO_ACCOUNT_SID = CONFIGURED.TWILIO_ACCOUNT_SID;
    h.env.TWILIO_AUTH_TOKEN = CONFIGURED.TWILIO_AUTH_TOKEN;
    expect(phoneVerificationEnabled()).toBe(false);
    h.env.TWILIO_VERIFY_SERVICE_SID = CONFIGURED.TWILIO_VERIFY_SERVICE_SID;
    expect(phoneVerificationEnabled()).toBe(true);
  });
});

describe("startPhoneVerification", () => {
  it("throws loud when unconfigured (never a silent no-op)", async () => {
    await expect(startPhoneVerification("+17207809044")).rejects.toThrow(PhoneVerifyError);
  });

  it("POSTs the number to the Verifications resource", async () => {
    Object.assign(h.env, CONFIGURED);
    const spy = mockFetch(201, { status: "pending" });
    await startPhoneVerification("+17207809044");
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://verify.twilio.com/v2/Services/${CONFIGURED.TWILIO_VERIFY_SERVICE_SID}/Verifications`,
    );
    expect(String(init.body)).toContain("To=%2B17207809044");
    expect(String(init.body)).toContain("Channel=sms");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  it("throws loud on an API error", async () => {
    Object.assign(h.env, CONFIGURED);
    mockFetch(429, { message: "Max send attempts reached" });
    await expect(startPhoneVerification("+17207809044")).rejects.toThrow(/429/);
  });
});

describe("checkPhoneVerification", () => {
  beforeEach(() => Object.assign(h.env, CONFIGURED));

  it("returns true only for status approved", async () => {
    mockFetch(200, { status: "approved" });
    expect(await checkPhoneVerification("+17207809044", "123456")).toBe(true);
  });

  it("returns false for a wrong code (status pending)", async () => {
    mockFetch(200, { status: "pending" });
    expect(await checkPhoneVerification("+17207809044", "000000")).toBe(false);
  });

  it("treats 404 (expired / never started) as not-approved, not an error", async () => {
    mockFetch(404, { message: "not found" });
    expect(await checkPhoneVerification("+17207809044", "123456")).toBe(false);
  });

  it("throws loud on other API errors", async () => {
    mockFetch(500, { message: "boom" });
    await expect(checkPhoneVerification("+17207809044", "123456")).rejects.toThrow(
      PhoneVerifyError,
    );
  });
});
