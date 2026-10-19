import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mfaOn: true,
  recent: { ok: true, sessionId: "s1", authMethod: "password", authPasskeyId: null } as Record<string, unknown>,
  passkeys: [] as unknown[],
  finish: { ok: true, passkeyId: "pk-1" } as Record<string, unknown>,
  removed: true,
  order: [] as string[],
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve({ ok: true, userId: "u1" }) }));
vi.mock("@/lib/auth/recent-auth", () => ({ requireRecentAuth: () => Promise.resolve(h.recent) }));
vi.mock("@/lib/auth/passkeys", () => ({
  mfaIsOn: () => Promise.resolve(h.mfaOn),
  listPasskeys: () => Promise.resolve(h.passkeys),
  registrationOptions: () => Promise.resolve({ challenge: "c" }),
  finishRegistration: () => {
    h.order.push("finish");
    return Promise.resolve(h.finish);
  },
  removePasskey: () => {
    h.order.push("remove");
    return Promise.resolve(h.removed);
  },
}));
vi.mock("@/lib/auth/sessions", () => ({
  signOutOtherSessions: (_tx: unknown, _u: string, keep: string) => {
    h.order.push(`signout-others:${keep}`);
    return Promise.resolve(1);
  },
}));
vi.mock("@/lib/auth/security-events", () => ({
  recordSecurityEvent: (_tx: unknown, e: { kind: string }) => {
    h.order.push(`event:${e.kind}`);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/auth/security-notices", () => ({
  notifySecurityChange: () => {
    h.order.push("notify");
    return Promise.resolve();
  },
}));
vi.mock("@/lib/db/schema", () => ({ users: {} }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/db", () => {
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([{ email: "pat@example.org", name: "Pat" }]) }) }) }),
    transaction: <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  finishPasskeyRegistrationAction,
  passkeyRegistrationOptionsAction,
  removePasskeyAction,
} from "@/app/(portal)/settings/mfa/passkey-actions";

const PK = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  h.mfaOn = true;
  h.recent = { ok: true, sessionId: "s1", authMethod: "password", authPasskeyId: null };
  h.passkeys = [];
  h.finish = { ok: true, passkeyId: "pk-1" };
  h.removed = true;
  h.order = [];
});

describe("passkey actions", () => {
  it("need two-factor on, and a recent login", async () => {
    h.mfaOn = false;
    expect(await passkeyRegistrationOptionsAction()).toMatchObject({ ok: false, error: expect.stringMatching(/two-factor/) });
    h.mfaOn = true;
    h.recent = { ok: false, reauth: true };
    expect(await passkeyRegistrationOptionsAction()).toMatchObject({ ok: false, reauth: true });
  });

  it("stops at ten passkeys", async () => {
    h.passkeys = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
    expect(await passkeyRegistrationOptionsAction()).toMatchObject({ ok: false, error: expect.stringMatching(/up to 10/) });
  });

  it("adding one needs a name, records it and sends a notice", async () => {
    expect(await finishPasskeyRegistrationAction({} as never, "  ")).toMatchObject({ ok: false });
    expect(await finishPasskeyRegistrationAction({} as never, "My iPhone")).toMatchObject({ ok: true });
    expect(h.order).toEqual(["finish", "event:passkey_added", "notify"]);
  });

  it("removing one signs the other browsers out, records it and sends a notice", async () => {
    const f = new FormData();
    f.set("passkeyId", PK);
    expect(await removePasskeyAction(null, f)).toMatchObject({ ok: true });
    expect(h.order).toEqual(["remove", "signout-others:s1", "event:passkey_removed", "notify"]);
  });

  it("removing one that's gone changes nothing", async () => {
    h.removed = false;
    const f = new FormData();
    f.set("passkeyId", PK);
    expect(await removePasskeyAction(null, f)).toMatchObject({ ok: false });
    expect(h.order).toEqual(["remove"]);
  });
});
