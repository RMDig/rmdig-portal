import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ gate: "ok" as string }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: h.gate, roles: [] }) }));

import { auth } from "@/lib/auth";
import { portalActor } from "@/lib/auth/portal-actor";

const authMock = vi.mocked(auth);

beforeEach(() => {
  h.gate = "ok";
  authMock.mockResolvedValue({ user: { id: "u1" } } as never);
});

describe("portalActor", () => {
  it("returns the signed-in user when MFA is satisfied or only nagged", async () => {
    expect(await portalActor()).toEqual({ ok: true, userId: "u1" });
    h.gate = "nag";
    expect(await portalActor()).toEqual({ ok: true, userId: "u1" });
  });

  it("refuses a signed-out caller", async () => {
    authMock.mockResolvedValue(null as never);
    expect(await portalActor()).toEqual({ ok: false, error: "You must be signed in." });
  });

  it("refuses a user who must enroll in MFA (actions skip the layout's redirect)", async () => {
    h.gate = "required";
    expect(await portalActor()).toEqual({ ok: false, error: "Set up two-factor authentication first." });
  });
});

// Every portal server action goes through portalActor, so none can skip the
// layout's MFA gate. Only the enrollment actions (how a user satisfies it)
// read the session directly.
describe("portal server actions", () => {
  const EXEMPT = new Set([join("app", "(portal)", "settings", "mfa", "actions.ts")]);
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
    });
  }
  const actionFiles = walk(join("app", "(portal)")).filter((p) => readFileSync(p, "utf8").startsWith('"use server"'));

  it("finds the action files", () => {
    expect(actionFiles.length).toBeGreaterThan(15);
  });

  it.each(actionFiles.filter((p) => !EXEMPT.has(p)))("%s uses portalActor, not auth()", (p) => {
    const src = readFileSync(p, "utf8");
    expect(src).not.toMatch(/\bauth\(\)/);
    expect(src).toMatch(/portalActor\(\)/);
  });
});
