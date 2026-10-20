import { randomBytes } from "node:crypto";

import { generate } from "otplib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  totpKeyUri,
  verifyTotpStep,
} from "@/lib/auth/mfa";

beforeAll(() => {
  // 32-byte hex key for AES-256-GCM.
  process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
});

describe("TOTP secret encryption", () => {
  it("round-trips a secret", () => {
    const secret = generateTotpSecret();
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret); // not plaintext
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("ABC")).not.toBe(encryptSecret("ABC"));
  });

  it("rejects a tampered ciphertext (GCM auth)", () => {
    const stored = encryptSecret("secret-value");
    const [v, kid, iv, tag, ct] = stored.split(":");
    expect([v, kid]).toEqual(["v1", "k1"]);
    const flipped = ct!.slice(0, -2) + (ct!.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptSecret(`${v}:${kid}:${iv}:${tag}:${flipped}`)).toThrow();
  });
});

describe("TOTP verify", () => {
  it("accepts a freshly generated code and rejects a wrong one", async () => {
    const secret = generateTotpSecret();
    const code = await generate({ secret });
    expect(await verifyTotpStep(secret, code)).toBe(Math.floor(Date.now() / 1000 / 30));
    expect(await verifyTotpStep(secret, "000000")).toBeNull();
  });

  it("rejects non-6-digit input without throwing", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotpStep(secret, "abc")).toBeNull();
    expect(await verifyTotpStep(secret, "12345")).toBeNull();
  });

  it("produces a scannable otpauth URI", () => {
    const uri = totpKeyUri("user@rmdig.ai", generateTotpSecret());
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=");
  });
});

describe("recovery codes", () => {
  it("generates 10 unique XXXX-XXXX codes by default", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("hashes case- and separator-insensitively", () => {
    expect(hashRecoveryCode("abcd-2345")).toBe(hashRecoveryCode("ABCD2345"));
    expect(hashRecoveryCode("ab cd 2345")).toBe(hashRecoveryCode("ABCD-2345"));
  });

  it("normalizes to uppercase alphanumerics", () => {
    expect(normalizeRecoveryCode("ab-cd 23")).toBe("ABCD23");
  });

  it("does not store the plaintext as its hash", () => {
    expect(hashRecoveryCode("ABCD-2345")).not.toBe("ABCD-2345");
    expect(hashRecoveryCode("ABCD-2345")).toMatch(/^[0-9a-f]{64}$/);
  });
});
