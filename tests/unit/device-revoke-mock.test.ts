import { beforeEach, describe, expect, it } from "vitest";

import { mockDevices } from "@/lib/avserv/client";
import {
  __resetDeviceRevokeMock,
  mockPreview,
  mockResetCode,
  mockRevoke,
  mockRevokeOthers,
} from "@/lib/avserv/device-revoke-mock";
import { predictRevokeMode } from "@/lib/avserv/device-revoke-types";

// The mock follows device_revoke.md rev 2: modes, safe repeats, upgrades, the
// keep check, and the preview's live items.

const ACCT = "11111111-1111-5111-8111-111111111111";
const [phone, laptop] = mockDevices(ACCT).map((d) => d.deviceId) as [string, string];
const NOW = new Date("2026-10-18T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => __resetDeviceRevokeMock());

describe("predictRevokeMode (rev 2 §1.1)", () => {
  it("is full only for a passkey enrolled at least 7 days before", () => {
    expect(predictRevokeMode({ method: "passkey", passkeyCreatedAt: daysAgo(7) }, NOW)).toBe("full");
    expect(predictRevokeMode({ method: "passkey", passkeyCreatedAt: daysAgo(6) }, NOW)).toBe("limited");
    expect(predictRevokeMode({ method: "passkey", passkeyCreatedAt: "garbage" }, NOW)).toBe("limited");
    expect(predictRevokeMode({ method: "password" }, NOW)).toBe("limited");
    expect(predictRevokeMode({ method: "other" }, NOW)).toBe("limited");
  });
});

describe("device revoke mock", () => {
  it("previews a trip under way on the first phone and nothing on the second", () => {
    const a = mockPreview(ACCT, phone);
    const b = mockPreview(ACCT, laptop);
    expect(a.ok && a.value.live.map((l) => l.kind)).toEqual(["checkout"]);
    expect(b.ok && b.value.live).toEqual([]);
    expect(mockPreview(ACCT, "33333333-3333-5333-8333-333333333333")).toMatchObject({ ok: false, code: "device_not_found" });
  });

  it("revokes once; a repeat keeps the first reason, and a trusted repeat upgrades to full", () => {
    const first = mockRevoke(ACCT, phone, { reason: "lost", authStrength: { method: "password" } }, NOW);
    expect(first).toMatchObject({ ok: true, value: { mode: "limited", alreadyRevoked: false, upgraded: false, reason: "lost" } });
    const again = mockRevoke(ACCT, phone, { reason: "stolen", authStrength: { method: "passkey", passkeyCreatedAt: daysAgo(30) } }, NOW);
    expect(again).toMatchObject({ ok: true, value: { mode: "full", alreadyRevoked: true, upgraded: true, reason: "lost" } });
    const weaker = mockRevoke(ACCT, phone, { reason: "user", authStrength: { method: "password" } }, NOW);
    expect(weaker).toMatchObject({ ok: true, value: { mode: "full", upgraded: false } });
    expect(mockPreview(ACCT, phone)).toMatchObject({ ok: true, value: { revoked: true } });
  });

  it("revokes every other phone, or all of them with keep = null", () => {
    const keepPhone = mockRevokeOthers(ACCT, { keepDeviceId: phone, reason: "user", authStrength: { method: "password" } }, NOW);
    expect(keepPhone.ok && keepPhone.value.revoked.map((r) => r.deviceId)).toEqual([laptop]);
    __resetDeviceRevokeMock();
    const none = mockRevokeOthers(ACCT, { keepDeviceId: null, reason: "user", authStrength: { method: "password" } }, NOW);
    expect(none.ok && none.value.revoked.map((r) => r.deviceId).sort()).toEqual([phone, laptop].sort());
  });

  it("revokes nothing when the phone to keep is unknown or already signed out", () => {
    expect(
      mockRevokeOthers(ACCT, { keepDeviceId: "33333333-3333-5333-8333-333333333333", reason: "user", authStrength: { method: "password" } }),
    ).toMatchObject({ ok: false, code: "device_not_found" });
    mockRevoke(ACCT, phone, { reason: "lost", authStrength: { method: "password" } });
    expect(mockRevokeOthers(ACCT, { keepDeviceId: phone, reason: "user", authStrength: { method: "password" } })).toMatchObject({
      ok: false,
      status: 409,
      code: "keep_device_revoked",
    });
  });

  it("mints an 8-character reset code for a live phone, valid 10 minutes, and refuses a revoked one", () => {
    const r = mockResetCode(ACCT, laptop, NOW);
    expect(r).toMatchObject({ ok: true, value: { deviceId: laptop, expiresAt: "2026-10-18T12:10:00.000Z" } });
    expect(r.ok && r.value.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    mockRevoke(ACCT, laptop, { reason: "lost", authStrength: { method: "password" } });
    expect(mockResetCode(ACCT, laptop, NOW)).toMatchObject({ ok: false, status: 409, code: "device_revoked" });
  });
});
