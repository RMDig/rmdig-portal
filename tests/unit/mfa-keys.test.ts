import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptWith, encryptWith, LEGACY_KID, parseMfaKeys, secretKid } from "@/lib/auth/mfa-keys";

const hex = () => randomBytes(32).toString("hex");

describe("parseMfaKeys (plan 36 H3)", () => {
  it("makes the original key k1, and current when it's the only one", () => {
    const k = hex();
    const set = parseMfaKeys(undefined, k);
    expect(set.current).toBe(LEGACY_KID);
    expect(set.keys.get("k1")!.toString("hex")).toBe(k);
  });

  it("makes the first packed key current, keeping the rest and k1 to decrypt", () => {
    const set = parseMfaKeys(`k2:${hex()},k3:${hex()}`, hex());
    expect(set.current).toBe("k2");
    expect([...set.keys.keys()].sort()).toEqual(["k1", "k2", "k3"]);
  });

  it("refuses a malformed, duplicate or contradictory key, and no key at all", () => {
    expect(() => parseMfaKeys("k2:zz", undefined)).toThrow(/64 hex/);
    expect(() => parseMfaKeys(`bad kid:${hex()}`, undefined)).toThrow(/kid:hex/);
    const k = hex();
    expect(() => parseMfaKeys(`k2:${k},k2:${k}`, undefined)).toThrow(/twice/);
    expect(() => parseMfaKeys(`k1:${hex()}`, hex())).toThrow(/same key/);
    expect(() => parseMfaKeys(undefined, undefined)).toThrow(/No MFA encryption key/);
  });
});

describe("encrypt and decrypt across a rotation", () => {
  const k1 = hex();
  const k2 = hex();
  const before = parseMfaKeys(undefined, k1);
  const after = parseMfaKeys(`k2:${k2}`, k1);

  it("writes v1:<kid>:… with the current key", () => {
    const stored = encryptWith(after, "JBSWY3DPEHPK3PXP");
    expect(stored.startsWith("v1:k2:")).toBe(true);
    expect(secretKid(stored)).toBe("k2");
    expect(decryptWith(after, stored)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("still reads a secret written with the old key, after the rotation", () => {
    const old = encryptWith(before, "JBSWY3DPEHPK3PXP");
    expect(secretKid(old)).toBe("k1");
    expect(decryptWith(after, old)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("reads the original three-part format as k1", () => {
    const v1 = encryptWith(before, "S").split(":");
    const legacy = v1.slice(2).join(":");
    expect(secretKid(legacy)).toBe("k1");
    expect(decryptWith(before, legacy)).toBe("S");
  });

  it("says which key is missing rather than failing obscurely", () => {
    const fromK2 = encryptWith(after, "S");
    expect(() => decryptWith(before, fromK2)).toThrow(/k2 is not configured/);
    expect(() => secretKid("garbage")).toThrow(/Malformed/);
  });
});
