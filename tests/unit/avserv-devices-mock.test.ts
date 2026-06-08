import { beforeEach, describe, expect, it, vi } from "vitest";

// v5-shaped UUID: version nibble 5, variant nibble in [89ab].
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "mock://localhost";
});

describe("listDevices (mock path)", () => {
  it("returns a deterministic list per account with UUID-shaped device ids", async () => {
    const { listDevices } = await import("@/lib/avserv/client");

    const a = await listDevices("acct-1");
    const b = await listDevices("acct-1");

    expect(a).toEqual(b); // deterministic across calls
    expect(a.length).toBeGreaterThan(0);
    for (const d of a) {
      expect(d.deviceId).toMatch(UUID_RE);
    }
  });

  it("gives different device ids to different accounts", async () => {
    const { listDevices } = await import("@/lib/avserv/client");

    const [a] = await listDevices("acct-1");
    const [b] = await listDevices("acct-2");

    expect(a!.deviceId).not.toBe(b!.deviceId);
  });

  it("exercises the nullable appVersion path (a device with no reported version)", async () => {
    const { listDevices } = await import("@/lib/avserv/client");

    const devices = await listDevices("acct-1");

    expect(devices.some((d) => d.appVersion === null)).toBe(true);
    expect(devices.some((d) => typeof d.appVersion === "string")).toBe(true);
  });

  it("returns RFC3339-parseable timestamps", async () => {
    const { listDevices } = await import("@/lib/avserv/client");

    for (const d of await listDevices("acct-1")) {
      expect(Number.isNaN(new Date(d.createdAt).getTime())).toBe(false);
      expect(Number.isNaN(new Date(d.lastSeenAt).getTime())).toBe(false);
    }
  });

  it("throws on an empty accountId", async () => {
    const { listDevices } = await import("@/lib/avserv/client");
    await expect(listDevices("")).rejects.toThrow();
  });

  it("throws when AVSERV_BASE_URL is unset", async () => {
    delete process.env.AVSERV_BASE_URL;
    vi.resetModules();
    const { listDevices } = await import("@/lib/avserv/client");
    await expect(listDevices("acct-1")).rejects.toThrow(/AVSERV_BASE_URL/);
  });
});
