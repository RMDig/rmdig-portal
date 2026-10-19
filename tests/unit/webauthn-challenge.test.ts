import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (n: string) => (h.jar.has(n) ? { value: h.jar.get(n)! } : undefined),
      set: (n: string, v: string) => h.jar.set(n, v),
      delete: (n: string) => h.jar.delete(n),
    }),
}));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_SECRET: "x".repeat(40), NODE_ENV: "test" } }));

import { consumeChallenge, issueChallenge } from "@/lib/auth/webauthn-challenge";

beforeEach(() => h.jar.clear());

describe("webauthn challenge cookie", () => {
  it("gives the challenge back once, for the same purpose and user", async () => {
    await issueChallenge("chal-1", "reauth", "u1");
    expect(await consumeChallenge("reauth", "u1")).toBe("chal-1");
    expect(await consumeChallenge("reauth", "u1")).toBeNull();
  });

  it("refuses another purpose or another user, and spends the cookie anyway", async () => {
    await issueChallenge("chal-1", "register", "u1");
    expect(await consumeChallenge("signin", null)).toBeNull();
    await issueChallenge("chal-2", "reauth", "u1");
    expect(await consumeChallenge("reauth", "u2")).toBeNull();
    expect(h.jar.size).toBe(0);
  });

  it("refuses a tampered or expired cookie", async () => {
    await issueChallenge("chal-1", "signin", null);
    const [name, value] = [...h.jar.entries()][0]!;
    const [body, mac] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ c: "evil", p: "signin", u: null, e: 9_999_999_999 })).toString("base64url");
    h.jar.set(name, `${forged}.${mac}`);
    expect(await consumeChallenge("signin", null)).toBeNull();

    vi.useFakeTimers();
    await issueChallenge("chal-2", "signin", null);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    expect(await consumeChallenge("signin", null)).toBeNull();
    vi.useRealTimers();
    expect(body).toBeTruthy();
  });
});
