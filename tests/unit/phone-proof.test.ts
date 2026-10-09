import { describe, expect, it, vi } from "vitest";

// The signed "this user verified this number" note from the Verify step.

vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_SECRET: "a".repeat(64) } }));

import { signPhoneProof, verifyPhoneProof } from "@/lib/phone/proof";

const USER = "user-1";
const PHONE = "+17207809044";
const NOW = Date.UTC(2026, 9, 8, 20, 0, 0);

describe("phone verification proof", () => {
  it("verifies for the same user and number before it expires", () => {
    const token = signPhoneProof(USER, PHONE, NOW);
    expect(verifyPhoneProof(token, USER, PHONE, NOW + 59 * 60 * 1000)).toBe(true);
  });

  it("expires after an hour", () => {
    const token = signPhoneProof(USER, PHONE, NOW);
    expect(verifyPhoneProof(token, USER, PHONE, NOW + 60 * 60 * 1000)).toBe(false);
  });

  it("is refused for another user or another number", () => {
    const token = signPhoneProof(USER, PHONE, NOW);
    expect(verifyPhoneProof(token, "user-2", PHONE, NOW)).toBe(false);
    expect(verifyPhoneProof(token, USER, "+17205550100", NOW)).toBe(false);
  });

  it("is refused when the expiry is altered, since it is part of the signature", () => {
    const [expiresAt, mac] = signPhoneProof(USER, PHONE, NOW).split(".");
    const extended = `${Number(expiresAt) + 24 * 60 * 60 * 1000}.${mac}`;
    expect(verifyPhoneProof(extended, USER, PHONE, NOW)).toBe(false);
  });

  it("is refused when malformed or forged", () => {
    expect(verifyPhoneProof("", USER, PHONE, NOW)).toBe(false);
    expect(verifyPhoneProof("not-a-proof", USER, PHONE, NOW)).toBe(false);
    expect(verifyPhoneProof(`${NOW + 1000}.${"A".repeat(43)}`, USER, PHONE, NOW)).toBe(false);
  });
});
