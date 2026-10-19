import { createHash } from "node:crypto";

import { mockDevices, type LinkedDevice } from "./client";
import {
  predictRevokeMode,
  type AuthStrength,
  type NodeAnswer,
  type Preview,
  type RevokeAnswer,
  type RevokeMode,
  type RevokeOthersAnswer,
  type RevokeReason,
} from "./device-revoke-types";

// In-process stand-in for AvServ's device_admin routes (device_revoke.md rev 2)
// under AVSERV_BASE_URL=mock://*, one node named "mock". The first mock phone
// has a trip under way, so the preview's warning shows; the second has none.
// State lives for the process.

const NODE = "mock";

interface MockRevoke {
  revokedAt: string;
  reason: RevokeReason;
  mode: RevokeMode;
}
const revoked = new Map<string, MockRevoke>();
const key = (accountId: string, deviceId: string) => `${accountId}:${deviceId}`;

/** Test-only: forget every mock revoke. */
export function __resetDeviceRevokeMock(): void {
  revoked.clear();
}

function mockUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  const id = hex.slice(0, 12) + "5" + hex.slice(13, 16) + variant + hex.slice(17, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

const notFound = (code: string): NodeAnswer<never> => ({ node: NODE, ok: false, status: 404, code });

/** The mock devices with this process's revokes laid over them (§3.6). */
export function mockDeviceList(accountId: string): LinkedDevice[] {
  return mockDevices(accountId).map((d) => {
    const r = revoked.get(key(accountId, d.deviceId));
    return { ...d, userRevokedAt: r?.revokedAt ?? null, revokeReason: r?.reason ?? null, revokeMode: r?.mode ?? null };
  });
}

export function mockPreview(accountId: string, deviceId: string): NodeAnswer<Preview> {
  const devices = mockDevices(accountId);
  const i = devices.findIndex((d) => d.deviceId === deviceId);
  if (i < 0) return notFound("device_not_found");
  const live = i === 0 ? [{ kind: "checkout", id: mockUuid(`mock-checkout:${deviceId}`) }] : [];
  return {
    node: NODE,
    ok: true,
    value: { accountId, deviceId, node: NODE, revoked: revoked.has(key(accountId, deviceId)), live },
  };
}

function apply(accountId: string, deviceId: string, reason: RevokeReason, mode: RevokeMode, now: Date) {
  const prev = revoked.get(key(accountId, deviceId));
  if (!prev) {
    const fresh = { revokedAt: now.toISOString(), reason, mode };
    revoked.set(key(accountId, deviceId), fresh);
    return { ...fresh, alreadyRevoked: false, upgraded: false };
  }
  // The first reason wins; a trusted repeat upgrades limited to full; nothing downgrades.
  const upgraded = prev.mode === "limited" && mode === "full";
  if (upgraded) prev.mode = "full";
  return { ...prev, alreadyRevoked: true, upgraded };
}

export function mockRevoke(
  accountId: string,
  deviceId: string,
  body: { reason: RevokeReason; authStrength: AuthStrength },
  now: Date = new Date(),
): NodeAnswer<RevokeAnswer> {
  if (!mockDevices(accountId).some((d) => d.deviceId === deviceId)) return notFound("device_not_found");
  const r = apply(accountId, deviceId, body.reason, predictRevokeMode(body.authStrength, now), now);
  return { node: NODE, ok: true, value: { accountId, deviceId, node: NODE, ...r } };
}

export function mockRevokeOthers(
  accountId: string,
  body: { keepDeviceId: string | null; reason: RevokeReason; authStrength: AuthStrength },
  now: Date = new Date(),
): NodeAnswer<RevokeOthersAnswer> {
  const devices = mockDevices(accountId);
  if (body.keepDeviceId !== null) {
    if (!devices.some((d) => d.deviceId === body.keepDeviceId)) return notFound("device_not_found");
    if (revoked.has(key(accountId, body.keepDeviceId))) {
      return { node: NODE, ok: false, status: 409, code: "keep_device_revoked" };
    }
  }
  const mode = predictRevokeMode(body.authStrength, now);
  const out = devices
    .filter((d) => d.deviceId !== body.keepDeviceId)
    .map((d) => ({ deviceId: d.deviceId, ...apply(accountId, d.deviceId, body.reason, mode, now) }))
    .map(({ deviceId, revokedAt, mode: m, alreadyRevoked, upgraded }) => ({ deviceId, revokedAt, mode: m, alreadyRevoked, upgraded }));
  return { node: NODE, ok: true, value: { accountId, node: NODE, keptDeviceId: body.keepDeviceId, revoked: out } };
}
