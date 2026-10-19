import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  available: true,
  accountId: "acct-1" as string | null,
  recent: { ok: true, sessionId: "s1", authMethod: "password", authPasskeyId: null } as
    | { ok: true; sessionId: string; authMethod: string | null; authPasskeyId: string | null }
    | { ok: false; reauth: true },
  passkeyCreated: null as Date | null,
  calls: [] as unknown[][],
  answers: [] as unknown[],
  revalidated: [] as string[],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/security-notices", () => ({ notifySecurityChange: () => Promise.resolve() }));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/recent-auth", () => ({ requireRecentAuth: () => Promise.resolve(h.recent) }));
vi.mock("@/lib/auth/passkeys", () => ({ passkeyCreatedAt: () => Promise.resolve(h.passkeyCreated) }));
vi.mock("@/lib/db/schema", () => ({ users: { __t: "users" } }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.accountId ? [{ avservAccountId: h.accountId }] : []) }) }),
    }),
  },
}));
vi.mock("@/lib/avserv/device-revoke", () => ({
  deviceRevokeAvailable: () => h.available,
  revokePreview: (...a: unknown[]) => {
    h.calls.push(["preview", ...a]);
    return Promise.resolve(h.answers);
  },
  revokeDevice: (...a: unknown[]) => {
    h.calls.push(["revoke", ...a]);
    return Promise.resolve(h.answers);
  },
  revokeOtherDevices: (...a: unknown[]) => {
    h.calls.push(["others", ...a]);
    return Promise.resolve(h.answers);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import {
  previewRevokeAction,
  revokeDeviceAction,
  revokeOtherDevicesAction,
} from "@/app/(portal)/settings/devices/actions";

const DEV = "22222222-2222-4222-8222-222222222222";
const fd = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};
const revokeOk = (node: string) => ({
  node,
  ok: true,
  value: { accountId: "acct-1", deviceId: DEV, node, revokedAt: "t", reason: "lost", mode: "limited", alreadyRevoked: false, upgraded: false },
});

beforeEach(() => {
  h.actor = { ok: true, userId: "u1" };
  h.available = true;
  h.accountId = "acct-1";
  h.recent = { ok: true, sessionId: "s1", authMethod: "password", authPasskeyId: null };
  h.calls = [];
  h.answers = [];
  h.passkeyCreated = null;
  h.revalidated = [];
});

describe("previewRevokeAction", () => {
  it("merges every node's preview and says the revoke will be limited before passkeys", async () => {
    h.answers = [{ node: "n2", ok: true, value: { accountId: "a", deviceId: DEV, node: "n2", revoked: false, live: [{ kind: "checkout", id: "c1", dueAt: "2026-10-19T22:30:00Z" }] } }];
    expect(await previewRevokeAction(DEV)).toEqual({
      ok: true,
      live: { checkouts: 1, helpRequests: 0, other: 0, nextDueAt: "2026-10-19T22:30:00Z" },
      dueText: "Mon, Oct 19, 4:30 PM MDT",
      revoked: false,
      incomplete: false,
      mode: "limited",
    });
    expect(h.calls[0]).toEqual(["preview", "acct-1", DEV, "u1"]);
  });

  it("needs a recent login, the key, a linked account and a real device id, before reading anything", async () => {
    h.recent = { ok: false, reauth: true };
    expect(await previewRevokeAction(DEV)).toMatchObject({ ok: false, reauth: true });
    h.recent = { ok: true, sessionId: "s1", authMethod: "password", authPasskeyId: null };
    h.available = false;
    expect(await previewRevokeAction(DEV)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't available/) });
    h.available = true;
    h.accountId = null;
    expect(await previewRevokeAction(DEV)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't linked/) });
    expect(await previewRevokeAction("nope")).toMatchObject({ ok: false });
    expect(h.calls).toEqual([]);
  });

  it("refuses to offer the revoke when no node answered", async () => {
    h.answers = [{ node: "n2", ok: false, code: "unreachable" }];
    expect(await previewRevokeAction(DEV)).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing changed/) });
  });
});

describe("revokeDeviceAction", () => {
  it("sends the reason and this session's authStrength, and reports Send Help still works", async () => {
    h.answers = [revokeOk("n2"), revokeOk("n3")];
    const res = await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "lost" }));
    expect(res).toEqual({ ok: true, status: "done", message: "Signed out. Send Help still works from it." });
    expect(h.calls[0]).toEqual(["revoke", "acct-1", DEV, { reason: "lost", authStrength: { method: "password" } }, "u1"]);
    expect(h.revalidated).toEqual(["/settings/devices"]);
  });

  it("sends 'other' for a Google or older session", async () => {
    h.recent = { ok: true, sessionId: "s1", authMethod: null, authPasskeyId: null };
    h.answers = [revokeOk("n2")];
    await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "user" }));
    expect((h.calls[0]![3] as { authStrength: unknown }).authStrength).toEqual({ method: "other" });
  });

  it("sends a passkey's enrolment time, which makes the revoke full at 7 days (rev 2 §3.3)", async () => {
    h.recent = { ok: true, sessionId: "s1", authMethod: "passkey", authPasskeyId: "pk-1" };
    h.passkeyCreated = new Date("2026-10-01T09:12:00Z");
    h.answers = [revokeOk("n2")];
    await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "lost" }));
    expect((h.calls[0]![3] as { authStrength: unknown }).authStrength).toEqual({ method: "passkey", passkeyCreatedAt: "2026-10-01T09:12:00.000Z" });
  });

  it("says full before the confirm when the session's passkey is 7+ days old", async () => {
    h.recent = { ok: true, sessionId: "s1", authMethod: "passkey", authPasskeyId: "pk-1" };
    h.passkeyCreated = new Date(Date.now() - 8 * 86_400_000);
    h.answers = [{ node: "n2", ok: true, value: { accountId: "a", deviceId: DEV, node: "n2", revoked: false, live: [] } }];
    expect(await previewRevokeAction(DEV)).toMatchObject({ ok: true, mode: "full" });
    h.passkeyCreated = new Date(Date.now() - 2 * 86_400_000);
    expect(await previewRevokeAction(DEV)).toMatchObject({ ok: true, mode: "limited" });
  });

  it("treats a passkey since removed as a password", async () => {
    h.recent = { ok: true, sessionId: "s1", authMethod: "passkey", authPasskeyId: "pk-gone" };
    h.passkeyCreated = null;
    h.answers = [revokeOk("n2")];
    await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "lost" }));
    expect((h.calls[0]![3] as { authStrength: unknown }).authStrength).toEqual({ method: "password" });
  });

  it("is honest about one node missing, and about none answering", async () => {
    h.answers = [revokeOk("n2"), { node: "n3", ok: false, code: "unreachable" }];
    expect(await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "lost" }))).toMatchObject({ ok: true, status: "partial" });
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "devices.revoke.node_missing", node: "n3" }));
    h.answers = [{ node: "n2", ok: false, code: "unreachable" }];
    expect(await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "lost" }))).toMatchObject({ ok: false });
  });

  it("needs a reason and a recent login", async () => {
    expect(await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "bored" }))).toMatchObject({ ok: false });
    h.recent = { ok: false, reauth: true };
    expect(await revokeDeviceAction(null, fd({ deviceId: DEV, reason: "lost" }))).toMatchObject({ ok: false, reauth: true });
    expect(h.calls).toEqual([]);
  });
});

describe("revokeOtherDevicesAction", () => {
  const othersOk = (node: string, ids: string[]) => ({
    node,
    ok: true,
    value: { accountId: "acct-1", node, keptDeviceId: DEV, revoked: ids.map((deviceId) => ({ deviceId, revokedAt: "t", mode: "limited", alreadyRevoked: false, upgraded: false })) },
  });

  it("keeps the chosen phone, or none", async () => {
    h.answers = [othersOk("n2", ["p1", "p2"])];
    expect(await revokeOtherDevicesAction(null, fd({ keep: DEV }))).toMatchObject({ ok: true, message: expect.stringMatching(/Signed out 2 phones/) });
    expect((h.calls[0]![2] as { keepDeviceId: unknown }).keepDeviceId).toBe(DEV);
    await revokeOtherDevicesAction(null, fd({ keep: "none" }));
    expect((h.calls[1]![2] as { keepDeviceId: unknown }).keepDeviceId).toBeNull();
  });

  it("needs a choice, and explains a node that doesn't know the kept phone yet", async () => {
    expect(await revokeOtherDevicesAction(null, fd({}))).toMatchObject({ ok: false });
    h.answers = [othersOk("n2", ["p1"]), { node: "n3", ok: false, status: 404, code: "device_not_found" }];
    expect(await revokeOtherDevicesAction(null, fd({ keep: DEV }))).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't know the phone/) });
  });
});
