import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real (non-mock) revoke client against stubbed nodes: every node is
// called, revoke routes sign as the device-admin key, the reader header and
// authStrength are sent, and each node's answer comes back on its own.

const h = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock("@/lib/avserv/service-jwt", () => ({
  signServiceJwt: (role: string = "default") => {
    h.roles.push(role);
    return Promise.resolve(`jwt-for-${role}`);
  },
  deviceAdminKeyConfigured: () => !!process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

const ACCT = "11111111-1111-5111-8111-111111111111";
const DEV = "22222222-2222-5222-8222-222222222222";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const revokeOk = (node: string, extra: Record<string, unknown> = {}) => ({
  accountId: ACCT,
  deviceId: DEV,
  node,
  revokedAt: "2026-10-18T17:02:11Z",
  reason: "lost",
  mode: "limited",
  alreadyRevoked: false,
  upgraded: false,
  liveActivityTokensDeleted: 1,
  ...extra,
});

let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  vi.resetModules();
  h.roles = [];
  calls = [];
  process.env.AVSERV_BASE_URL = "https://avserv-2.example";
  process.env.AVSERV_FAILOVER_BASE_URL = "https://avserv-3.example";
  process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64 = "present";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AVSERV_FAILOVER_BASE_URL;
  delete process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64;
});

function stubNodes(answer: (url: string) => Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const a = answer(url);
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    }),
  );
}

describe("revokeDevice (real path)", () => {
  it("calls every node as the device-admin key, with the reader and authStrength", async () => {
    stubNodes((url) => json(200, revokeOk(new URL(url).host)));
    const { revokeDevice } = await import("@/lib/avserv/device-revoke");
    const answers = await revokeDevice(ACCT, DEV, { reason: "lost", authStrength: { method: "password" } }, "u1");

    expect(answers.map((a) => a.ok)).toEqual([true, true]);
    expect(calls.map((c) => new URL(c.url).host).sort()).toEqual(["avserv-2.example", "avserv-3.example"]);
    expect(h.roles).toEqual(["device_admin", "device_admin"]);
    for (const c of calls) {
      expect(c.url).toContain(`/v1/internal/accounts/${ACCT}/devices/${DEV}/revoke`);
      expect(c.init.method).toBe("POST");
      const headers = c.init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer jwt-for-device_admin");
      expect(headers["x-avai-reader"]).toBe("portal-user:u1");
      expect(JSON.parse(String(c.init.body))).toEqual({ reason: "lost", authStrength: { method: "password" } });
    }
  });

  it("returns a node that didn't answer as missing, and the other's answer as is", async () => {
    stubNodes((url) => (url.includes("avserv-3") ? new TypeError("fetch failed") : json(200, revokeOk("avserv-2.example"))));
    const { revokeDevice } = await import("@/lib/avserv/device-revoke");
    const answers = await revokeDevice(ACCT, DEV, { reason: "lost", authStrength: { method: "password" } }, "u1");
    expect(answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: "avserv-2.example", ok: true }),
        expect.objectContaining({ node: "avserv-3.example", ok: false, code: "unreachable" }),
      ]),
    );
  });

  it("carries AvServ's error code, and treats a drifted body as a failure", async () => {
    stubNodes((url) =>
      url.includes("avserv-3")
        ? json(404, { code: "device_not_found", error: "not here" })
        : json(200, { accountId: ACCT, node: "x" }),
    );
    const { revokeDevice } = await import("@/lib/avserv/device-revoke");
    const answers = await revokeDevice(ACCT, DEV, { reason: "lost", authStrength: { method: "password" } }, "u1");
    expect(answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: "avserv-3.example", ok: false, status: 404, code: "device_not_found" }),
        expect.objectContaining({ node: "avserv-2.example", ok: false, code: "bad_response" }),
      ]),
    );
  });
});

describe("revokeOtherDevices (real path)", () => {
  it("always sends keepDeviceId, null for none", async () => {
    stubNodes((url) => json(200, { accountId: ACCT, node: new URL(url).host, keptDeviceId: null, revoked: [] }));
    const { revokeOtherDevices } = await import("@/lib/avserv/device-revoke");
    await revokeOtherDevices(ACCT, { keepDeviceId: null, reason: "user", authStrength: { method: "other" } }, "u1");
    for (const c of calls) {
      expect(c.url).toContain(`/v1/internal/accounts/${ACCT}/devices/revoke-others`);
      const body = JSON.parse(String(c.init.body));
      expect(body).toHaveProperty("keepDeviceId", null);
      expect(body.authStrength).toEqual({ method: "other" });
    }
  });
});

describe("listDevicesEveryNode (real path)", () => {
  const device = (extra: Record<string, unknown> = {}) => ({
    deviceId: DEV,
    platform: "iOS",
    appVersion: null,
    createdAt: "2026-04-02T11:00:00Z",
    lastSeenAt: "2026-05-28T18:42:00Z",
    ...extra,
  });

  it("reads every node as the everyday key, with no reader header", async () => {
    stubNodes(() => json(200, { devices: [device()] }));
    const { listDevicesEveryNode } = await import("@/lib/avserv/device-revoke");
    const merged = await listDevicesEveryNode(ACCT);
    expect(merged.devices).toHaveLength(1);
    expect(h.roles).toEqual(["default", "default"]);
    for (const c of calls) expect((c.init.headers as Record<string, string>)["x-avai-reader"]).toBeUndefined();
  });

  it("marks a phone signed out when only one node knows it yet", async () => {
    stubNodes((url) =>
      json(200, {
        devices: [url.includes("avserv-3") ? device({ userRevokedAt: "2026-10-18T17:02:11Z", revokeReason: "lost", revokeMode: "limited" }) : device()],
      }),
    );
    const { listDevicesEveryNode } = await import("@/lib/avserv/device-revoke");
    const [d] = (await listDevicesEveryNode(ACCT)).devices;
    expect(d).toMatchObject({ userRevokedAt: "2026-10-18T17:02:11Z", revokeReason: "lost", revokeMode: "limited" });
  });

  it("says incomplete when one node is down, and throws when none answers", async () => {
    stubNodes((url) => (url.includes("avserv-3") ? new TypeError("down") : json(200, { devices: [device()] })));
    const { listDevicesEveryNode } = await import("@/lib/avserv/device-revoke");
    expect((await listDevicesEveryNode(ACCT)).incomplete).toBe(true);

    vi.resetModules();
    stubNodes(() => new TypeError("down"));
    const again = await import("@/lib/avserv/device-revoke");
    await expect(again.listDevicesEveryNode(ACCT)).rejects.toMatchObject({ code: "unreachable" });
  });
});

describe("deviceRevokeAvailable", () => {
  it("is off against a real AvServ until the device-admin key is set", async () => {
    delete process.env.AVSERV_DEVICE_ADMIN_JWT_SIGNING_KEY_B64;
    const { deviceRevokeAvailable } = await import("@/lib/avserv/device-revoke");
    expect(deviceRevokeAvailable()).toBe(false);
  });
});
