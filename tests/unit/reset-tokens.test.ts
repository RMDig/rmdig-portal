import { describe, expect, it } from "vitest";

import {
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MINUTES,
} from "@/lib/auth/reset-tokens";

describe("reset-token helpers", () => {
  it("hashes deterministically (same token → same hash)", () => {
    expect(hashResetToken("abc")).toBe(hashResetToken("abc"));
    expect(hashResetToken("abc")).not.toBe(hashResetToken("abd"));
  });

  it("produces a 64-char hex SHA-256 hash", () => {
    expect(hashResetToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a high-entropy token whose hash matches the helper", () => {
    const { token, tokenHash } = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
    expect(tokenHash).toBe(hashResetToken(token));
  });

  it("never stores the plaintext token as its own hash", () => {
    const { token, tokenHash } = generateResetToken();
    expect(tokenHash).not.toBe(token);
  });

  it("sets expiry to the configured TTL in the future", () => {
    const { expires } = generateResetToken();
    const ms = expires.getTime() - Date.now();
    expect(ms).toBeGreaterThan((RESET_TOKEN_TTL_MINUTES - 1) * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(RESET_TOKEN_TTL_MINUTES * 60 * 1000 + 1000);
  });

  it("generates a distinct token each call", () => {
    expect(generateResetToken().token).not.toBe(generateResetToken().token);
  });
});
