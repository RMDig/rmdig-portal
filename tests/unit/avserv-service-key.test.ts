import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkServiceKeyConfig, parseServiceKey } from "@/lib/avserv/service-key";

// The key format and the build-time check (scripts/check-service-key.ts).
const ed = generateKeyPairSync("ed25519");
const pem = ed.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const b64 = Buffer.from(pem).toString("base64");
// What AvServ prints: SHA-256 of the DER public key.
const fp = createHash("sha256").update(ed.publicKey.export({ type: "spki", format: "der" })).digest("hex");
const REAL = "https://avserv-2.rmdig.ai";

describe("parseServiceKey", () => {
  it("loads one base64 line of a PKCS#8 Ed25519 PEM and fingerprints it as AvServ does", () => {
    expect(parseServiceKey(b64)).toEqual({ ok: true, pem, fingerprint: fp });
  });

  it("refuses the ways the old multi-line value broke, without echoing the key", () => {
    for (const bad of [`"${b64}"`, ` ${b64}`, pem, pem.replace(/\n/g, "\\n")]) {
      const r = parseServiceKey(bad);
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/one base64 line/) });
      expect(JSON.stringify(r)).not.toContain(b64.slice(40, 80));
    }
  });

  it("refuses base64 of something that isn't a PKCS#8 Ed25519 key", () => {
    expect(parseServiceKey(Buffer.from("hello").toString("base64"))).toMatchObject({ ok: false, error: expect.stringMatching(/PKCS#8/) });
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(parseServiceKey(Buffer.from(rsa).toString("base64"))).toMatchObject({ ok: false, error: expect.stringMatching(/Ed25519, not rsa/) });
  });
});

describe("checkServiceKeyConfig (the build check)", () => {
  it("skips a mock or absent AvServ", () => {
    expect(checkServiceKeyConfig({ AVSERV_BASE_URL: "mock://localhost" })).toEqual({ status: "skipped" });
    expect(checkServiceKeyConfig({})).toEqual({ status: "skipped" });
  });

  it("passes when the key loads and matches AvServ's fingerprint for the kid", () => {
    expect(
      checkServiceKeyConfig({ AVSERV_BASE_URL: REAL, AVSERV_SERVICE_JWT_SIGNING_KEY_B64: b64, AVSERV_SERVICE_JWT_KEY_SHA256: fp.toUpperCase() }),
    ).toEqual({ status: "ok", kid: "svc-key-portal-1", fingerprint: fp });
  });

  it("fails the build for a missing key, a missing or wrong fingerprint, or a bad kid", () => {
    expect(checkServiceKeyConfig({ AVSERV_BASE_URL: REAL })).toMatchObject({ status: "error", error: expect.stringMatching(/not set/) });
    expect(checkServiceKeyConfig({ AVSERV_BASE_URL: REAL, AVSERV_SERVICE_JWT_SIGNING_KEY_B64: b64 })).toMatchObject({
      status: "error",
      error: expect.stringContaining(fp),
    });
    expect(checkServiceKeyConfig({ AVSERV_BASE_URL: REAL, AVSERV_SERVICE_JWT_SIGNING_KEY_B64: b64, AVSERV_SERVICE_JWT_KEY_SHA256: "0".repeat(64) })).toMatchObject({
      status: "error",
      error: expect.stringMatching(/doesn't match/),
    });
    expect(
      checkServiceKeyConfig({ AVSERV_BASE_URL: REAL, AVSERV_SERVICE_JWT_SIGNING_KEY_B64: b64, AVSERV_SERVICE_JWT_KEY_SHA256: fp, AVSERV_SERVICE_JWT_KID: "bad kid" }),
    ).toMatchObject({ status: "error", error: expect.stringMatching(/valid key id/) });
  });
});
