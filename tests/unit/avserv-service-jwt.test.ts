import { generateKeyPairSync } from "node:crypto";

import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real Ed25519 keypair for the suite: sign with the PKCS#8 private half (as the
// portal would), verify with the SPKI public half (as AvServ would).
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const spki = publicKey.export({ type: "spki", format: "pem" }).toString();

beforeEach(() => {
  // Fresh module each test so the in-module key cache doesn't leak across cases.
  vi.resetModules();
  delete process.env.AVSERV_SERVICE_JWT_SIGNING_KEY;
});

describe("signServiceJwt", () => {
  it("signs an EdDSA token AvServ can verify, with the contract header + claims", async () => {
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY = pkcs8;
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");

    const token = await signServiceJwt();

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("EdDSA");
    expect(header.kid).toBe("svc-key-portal-1");

    const pub = await importSPKI(spki, "EdDSA");
    const { payload } = await jwtVerify(token, pub, {
      issuer: "rmdig-portal",
      audience: "internal",
    });
    expect(payload.iss).toBe("rmdig-portal");
    expect(payload.aud).toBe("internal");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
  });

  it("keeps the TTL within the 5-minute contract ceiling", async () => {
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY = pkcs8;
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");

    const token = await signServiceJwt();
    const pub = await importSPKI(spki, "EdDSA");
    const { payload } = await jwtVerify(token, pub);

    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(300);
  });

  it("rejects PKCS#8 keys stored with literal \\n escapes? no — it normalizes them", async () => {
    // Env PEMs arrive single-line with literal "\n" (Apple Option-A convention).
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY = pkcs8.replace(/\n/g, "\\n");
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");

    const token = await signServiceJwt();
    const pub = await importSPKI(spki, "EdDSA");
    await expect(jwtVerify(token, pub)).resolves.toBeDefined();
  });

  it("fails loud when the signing key is absent", async () => {
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");
    await expect(signServiceJwt()).rejects.toThrow(/AVSERV_SERVICE_JWT_SIGNING_KEY/);
  });
});
