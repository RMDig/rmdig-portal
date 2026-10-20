import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  step: 59_000_000 as number | null,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return { users: fakeTable("users"), mfaRecoveryCodes: fakeTable("mfa_recovery_codes") };
});
vi.mock("@/lib/db", () => ({
  get db() {
    return h.fake!.db;
  },
}));
vi.mock("@/lib/auth/mfa", () => ({
  verifyTotpStep: () => Promise.resolve(h.step),
  hashRecoveryCode: (c: string) => `hash(${c})`,
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { claimTotpStep, verifySecondFactor } from "@/lib/auth/mfa-verify";
import { createFakeDb } from "./helpers/fake-db";

beforeEach(() => {
  h.fake = createFakeDb();
  h.step = 59_000_000;
  h.fake.rows("users").push({ id: "u1", totpLastStep: null });
});

describe("claimTotpStep (plan 36 H3)", () => {
  it("accepts a step once, then only newer ones", async () => {
    expect(await claimTotpStep("u1", 100)).toBe(true);
    expect(await claimTotpStep("u1", 100)).toBe(false);
    expect(await claimTotpStep("u1", 99)).toBe(false);
    expect(await claimTotpStep("u1", 101)).toBe(true);
    expect(h.fake!.rows("users")[0]!.totpLastStep).toBe(101);
  });
});

describe("verifySecondFactor", () => {
  it("accepts a right code once and refuses it replayed within its window", async () => {
    expect(await verifySecondFactor("u1", "secret", "123456")).toBe(true);
    expect(await verifySecondFactor("u1", "secret", "123456")).toBe(false);
    expect(h.log.warn).toHaveBeenCalledWith({ event: "mfa.totp.replayed", userId: "u1" });
  });

  it("accepts the next window's code after one was used", async () => {
    await verifySecondFactor("u1", "secret", "123456");
    h.step = 59_000_001;
    expect(await verifySecondFactor("u1", "secret", "654321")).toBe(true);
  });
});
