import { beforeEach, describe, expect, it, vi } from "vitest";

// v5-shaped UUID: version nibble 5, variant nibble in [89ab].
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const A = "11111111-1111-5111-8111-111111111111";
const B = "22222222-2222-5222-8222-222222222222";

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "mock://localhost";
});

describe("listDevicesEveryNode (mock path)", () => {
  it("returns a deterministic list per account with UUID-shaped device ids, none signed out", async () => {
    const { listDevicesEveryNode } = await import("@/lib/avserv/device-revoke");
    const first = await listDevicesEveryNode(A);
    const again = await listDevicesEveryNode(A);
    expect(first).toEqual(again);
    expect(first.devices).toHaveLength(2);
    expect(first.incomplete).toBe(false);
    for (const d of first.devices) {
      expect(d.deviceId).toMatch(UUID_RE);
      expect(d.userRevokedAt).toBeNull();
    }
  });

  it("gives different device ids to different accounts", async () => {
    const { listDevicesEveryNode } = await import("@/lib/avserv/device-revoke");
    const a = (await listDevicesEveryNode(A)).devices.map((d) => d.deviceId);
    const b = (await listDevicesEveryNode(B)).devices.map((d) => d.deviceId);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });

  it("exercises the nullable appVersion path and RFC3339 timestamps", async () => {
    const { listDevicesEveryNode } = await import("@/lib/avserv/device-revoke");
    const { devices } = await listDevicesEveryNode(A);
    expect(devices.some((d) => d.appVersion === null)).toBe(true);
    for (const d of devices) {
      expect(Number.isNaN(Date.parse(d.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(d.lastSeenAt))).toBe(false);
    }
  });

  it("keeps a signed-out phone listed, with when, why and the mode", async () => {
    const { listDevicesEveryNode, revokeDevice } = await import("@/lib/avserv/device-revoke");
    const { __resetDeviceRevokeMock } = await import("@/lib/avserv/device-revoke-mock");
    __resetDeviceRevokeMock();
    const phone = (await listDevicesEveryNode(A)).devices[0]!;
    await revokeDevice(A, phone.deviceId, { reason: "lost", authStrength: { method: "password" } }, "u1");
    const after = (await listDevicesEveryNode(A)).devices.find((d) => d.deviceId === phone.deviceId)!;
    expect(after.userRevokedAt).toBeTruthy();
    expect(after.revokeReason).toBe("lost");
    expect(after.revokeMode).toBe("limited");
  });
});
