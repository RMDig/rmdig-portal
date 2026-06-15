import { describe, expect, it } from "vitest";

import {
  generateInviteToken,
  hashInviteToken,
  INVITE_TOKEN_TTL_DAYS,
} from "@/lib/sar/invitations";

describe("invite tokens", () => {
  it("stores a hash that matches the plaintext token", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toBe(token); // we never persist the plaintext
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
  });

  it("expires roughly INVITE_TOKEN_TTL_DAYS out", () => {
    const { expires } = generateInviteToken();
    const days = (expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(INVITE_TOKEN_TTL_DAYS - 0.01);
    expect(days).toBeLessThanOrEqual(INVITE_TOKEN_TTL_DAYS + 0.01);
  });

  it("generates a fresh token each call", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
});
