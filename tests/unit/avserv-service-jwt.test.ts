import { generateKeyPairSync } from "node:crypto";

import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real Ed25519 keypair for the suite: sign with the private half as the portal
// does (stored as one base64 line), verify with the public half as AvServ does.
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const b64 = Buffer.from(pkcs8).toString("base64");
const spki = publicKey.export({ type: "spki", format: "pem" }).toString();

beforeEach(() => {
  // Fresh module each test so the in-module key cache doesn't leak across cases.
  vi.resetModules();
  delete process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64;
  delete process.env.AVSERV_SERVICE_JWT_KID;
  delete process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64;
  delete process.env.AVSERV_DEVICE_ADMIN_JWT_KID;
});

describe("signServiceJwt by role (plan 36 S3)", () => {
  it("signs device_admin calls with the device-admin key and kid, never the everyday one", async () => {
    const other = generateKeyPairSync("ed25519");
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64 = b64;
    process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64 = Buffer.from(
      other.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ).toString("base64");
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");

    const admin = await signServiceJwt("device_admin");
    expect(decodeProtectedHeader(admin).kid).toBe("svc-key-portal-device-admin-1");
    const adminPub = await importSPKI(other.publicKey.export({ type: "spki", format: "pem" }).toString(), "EdDSA");
    await expect(jwtVerify(admin, adminPub)).resolves.toBeTruthy();
    // The everyday key's public half must not verify a device-admin token.
    await expect(jwtVerify(admin, await importSPKI(spki, "EdDSA"))).rejects.toThrow();

    expect(decodeProtectedHeader(await signServiceJwt()).kid).toBe("svc-key-portal-1");
  });

  it("fails loud without the device-admin key rather than borrowing the everyday one", async () => {
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64 = b64;
    const { signServiceJwt, deviceAdminKeyConfigured } = await import("@/lib/avserv/service-jwt");
    expect(deviceAdminKeyConfigured()).toBe(false);
    await expect(signServiceJwt("device_admin")).rejects.toThrow(/AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64/);
  });
});

describe("signServiceJwt", () => {
  it("signs an EdDSA token AvServ can verify, with the contract header + claims", async () => {
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64 = b64;
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");

    const token = await signServiceJwt();

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("EdDSA");
    expect(header.kid).toBe("svc-key-portal-1");

    const pub = await importSPKI(spki, "EdDSA");
    const { payload } = await jwtVerify(token, pub, { issuer: "rmdig-portal", audience: "internal" });
    expect(typeof payload.iat).toBe("number");
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(300);
  });

  it("signs as the configured kid, for rotation with overlap", async () => {
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64 = b64;
    process.env.AVSERV_SERVICE_JWT_KID = "svc-key-portal-2";
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");
    expect(decodeProtectedHeader(await signServiceJwt()).kid).toBe("svc-key-portal-2");
  });

  it("fails loud when the key is absent or not one clean base64 line", async () => {
    const { signServiceJwt } = await import("@/lib/avserv/service-jwt");
    await expect(signServiceJwt()).rejects.toThrow(/AVSERV_SERVICE_JWT_SIGNING_KEY_B64 is not set/);
    vi.resetModules();
    process.env.AVSERV_SERVICE_JWT_SIGNING_KEY_B64 = `"${b64}"`;
    const again = await import("@/lib/avserv/service-jwt");
    await expect(again.signServiceJwt()).rejects.toThrow(/one base64 line/);
  });
});
