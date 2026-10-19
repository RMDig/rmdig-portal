import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  challenge: "chal" as string | null,
  issued: [] as unknown[][],
  consumed: [] as unknown[][],
  verifyReg: { verified: true } as Record<string, unknown>,
  verifyAuth: null as null | (() => unknown),
  problems: [] as string[],
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return { users: fakeTable("users"), webauthnCredentials: fakeTable("webauthn_credentials") };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));
vi.mock("@/lib/auth/webauthn-challenge", () => ({
  issueChallenge: (...a: unknown[]) => {
    h.issued.push(a);
    return Promise.resolve();
  },
  consumeChallenge: (...a: unknown[]) => {
    h.consumed.push(a);
    return Promise.resolve(h.challenge);
  },
}));
vi.mock("@/lib/auth/webauthn-config", () => ({
  RP_NAME: "rmdig",
  currentRelyingParty: () => Promise.resolve({ rpID: "rmdig.ai", origin: "https://rmdig.ai" }),
}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (o: Record<string, unknown>) => Promise.resolve({ challenge: "reg-chal", ...o }),
  generateAuthenticationOptions: (o: Record<string, unknown>) => Promise.resolve({ challenge: "auth-chal", ...o }),
  verifyRegistrationResponse: () => Promise.resolve(h.verifyReg),
  verifyAuthenticationResponse: () => Promise.resolve(h.verifyAuth!()),
}));
vi.mock("@/lib/report-error", () => ({ reportProblem: (e: string) => h.problems.push(e) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  authenticationOptions,
  finishRegistration,
  registrationOptions,
  removePasskey,
  verifyPasskeyAssertion,
} from "@/lib/auth/passkeys";
import { createFakeDb } from "./helpers/fake-db";

const USER = { id: "u1", email: "pat@example.org", name: "Pat" };

beforeEach(() => {
  h.fake = createFakeDb();
  h.challenge = "chal";
  h.issued = [];
  h.consumed = [];
  h.problems = [];
  h.verifyReg = {
    verified: true,
    registrationInfo: { credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal", "hybrid"] } },
  };
  h.verifyAuth = () => ({ verified: true, authenticationInfo: { newCounter: 5 } });
});

describe("registration", () => {
  it("asks for a discoverable, user-verified passkey and binds the challenge to the user", async () => {
    const o = (await registrationOptions(USER)) as unknown as Record<string, unknown>;
    expect(o.authenticatorSelection).toEqual({ residentKey: "required", userVerification: "required" });
    expect(o.rpID).toBe("rmdig.ai");
    expect(h.issued).toEqual([["reg-chal", "register", "u1"]]);
  });

  it("stores only the public key, with its name, and returns the new passkey's id", async () => {
    const r = await finishRegistration("u1", {} as never, "My iPhone");
    expect(r.ok).toBe(true);
    const [row] = h.fake!.rows("webauthn_credentials");
    expect(row).toMatchObject({ userId: "u1", credentialId: "cred-1", nickname: "My iPhone", counter: 0, transports: "internal,hybrid" });
    expect(typeof row!.publicKey).toBe("string");
  });

  it("refuses without this ceremony's challenge, or when the device's answer doesn't verify", async () => {
    h.challenge = null;
    expect((await finishRegistration("u1", {} as never, "x")).ok).toBe(false);
    h.challenge = "chal";
    h.verifyReg = { verified: false };
    expect((await finishRegistration("u1", {} as never, "x")).ok).toBe(false);
    expect(h.fake!.rows("webauthn_credentials")).toEqual([]);
  });
});

describe("assertion", () => {
  beforeEach(() => {
    h.fake!.rows("webauthn_credentials").push({ id: "pk-1", userId: "u1", credentialId: "cred-1", publicKey: "AQID", counter: 2, transports: "internal" });
  });

  it("names no credentials in the sign-in options, so nothing about an account leaks", async () => {
    const o = (await authenticationOptions("signin", null)) as unknown as Record<string, unknown>;
    expect(o.allowCredentials).toBeUndefined();
    expect(o.userVerification).toBe("required");
    expect(h.issued).toEqual([["auth-chal", "signin", null]]);
  });

  it("accepts the user's own passkey and stores the new counter", async () => {
    expect(await verifyPasskeyAssertion("u1", JSON.stringify({ id: "cred-1" }), "signin")).toEqual({ ok: true, passkeyId: "pk-1" });
    expect(h.fake!.rows("webauthn_credentials")[0]).toMatchObject({ counter: 5 });
    expect(h.consumed).toEqual([["signin", null]]);
  });

  it("binds a re-auth challenge to the user", async () => {
    await verifyPasskeyAssertion("u1", JSON.stringify({ id: "cred-1" }), "reauth");
    expect(h.consumed).toEqual([["reauth", "u1"]]);
  });

  it("refuses another user's passkey, garbage, or no challenge", async () => {
    expect(await verifyPasskeyAssertion("u2", JSON.stringify({ id: "cred-1" }), "signin")).toEqual({ ok: false });
    expect(await verifyPasskeyAssertion("u1", "not json", "signin")).toEqual({ ok: false });
    h.challenge = null;
    expect(await verifyPasskeyAssertion("u1", JSON.stringify({ id: "cred-1" }), "signin")).toEqual({ ok: false });
  });

  it("refuses a counter that went backwards and reports it", async () => {
    h.verifyAuth = () => {
      throw new Error("Response counter value 1 was lower than expected 2");
    };
    expect(await verifyPasskeyAssertion("u1", JSON.stringify({ id: "cred-1" }), "signin")).toEqual({ ok: false });
    expect(h.problems).toEqual(["passkeys.assert.counter_regression"]);
    expect(h.fake!.rows("webauthn_credentials")[0]).toMatchObject({ counter: 2 });
  });

  it("removes only the user's own passkey", async () => {
    expect(await removePasskey(h.fake!.db as never, "u2", "pk-1")).toBe(false);
    expect(await removePasskey(h.fake!.db as never, "u1", "pk-1")).toBe(true);
    expect(h.fake!.rows("webauthn_credentials")).toEqual([]);
  });
});
