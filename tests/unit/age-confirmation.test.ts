import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

// The 18+ statement (owner, 2026-11-16): recorded once per account, by the
// email sign-up form or by /confirm-age, where the portal layout sends every
// signed-in account until it is recorded.

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  session: { user: { id: "u1" } } as { user: { id: string } } | null,
  recordFails: false,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return { users: fakeTable("users") };
});
vi.mock("@/lib/db", () => ({
  get db() {
    if (h.recordFails) throw new Error("db down");
    return h.fake!.db;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.session) }));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));

import { confirmAgeAction } from "@/app/(age-confirm)/confirm-age/actions";
import { ageConfirmed, recordAgeConfirmation } from "@/lib/auth/age-gate";

import { createFakeDb } from "./helpers/fake-db";

function seedUser(ageConfirmedAt: Date | null = null) {
  h.fake!.rows("users").push({ id: "u1", email: "pat@example.org", ageConfirmedAt });
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.fake = createFakeDb();
  h.session = { user: { id: "u1" } };
  h.recordFails = false;
});

describe("lib/auth/age-gate", () => {
  it("reads an account as unconfirmed until it confirms, then confirmed", async () => {
    seedUser();
    expect(await ageConfirmed("u1")).toBe(false);
    expect(await recordAgeConfirmation("u1", new Date("2026-11-16T12:00:00Z"))).toBe(true);
    expect(await ageConfirmed("u1")).toBe(true);
  });

  it("keeps the first confirmation's time", async () => {
    const first = new Date("2026-11-01T00:00:00Z");
    seedUser(first);
    await recordAgeConfirmation("u1", new Date("2026-11-16T00:00:00Z"));
    expect(h.fake!.rows("users")[0]!.ageConfirmedAt).toEqual(first);
  });

  it("answers false for a user that doesn't exist", async () => {
    expect(await recordAgeConfirmation("nobody")).toBe(false);
  });
});

describe("confirmAgeAction", () => {
  it("records the confirmation and returns to the page they were going to", async () => {
    seedUser();
    await expect(confirmAgeAction(null, form({ ageConfirmed: "on", next: "/sar/new" }))).rejects.toThrow("NEXT_REDIRECT:/sar/new");
    expect(h.fake!.rows("users")[0]!.ageConfirmedAt).toBeInstanceOf(Date);
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "age.confirmed", userId: "u1" }));
  });

  it("goes to the dashboard when there's no safe page to return to", async () => {
    seedUser();
    await expect(confirmAgeAction(null, form({ ageConfirmed: "on", next: "https://evil.example" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
  });

  it("refuses without the box ticked and records nothing", async () => {
    seedUser();
    const res = await confirmAgeAction(null, form({ next: "/dashboard" }));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/18 or older/) });
    expect(h.fake!.rows("users")[0]!.ageConfirmedAt).toBeNull();
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("refuses without a session", async () => {
    h.session = null;
    const res = await confirmAgeAction(null, form({ ageConfirmed: "on" }));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/sign in again/i) });
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("fails loud when the database write fails", async () => {
    h.recordFails = true;
    const res = await confirmAgeAction(null, form({ ageConfirmed: "on" }));
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/couldn't save/i) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "age.confirm_failed" }));
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("fails loud when the session's user row is gone", async () => {
    const res = await confirmAgeAction(null, form({ ageConfirmed: "on" }));
    expect(res?.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "age.confirm_no_user" }));
  });
});

describe("the age gate's placement", () => {
  it("lives outside the portal layout that redirects to it", () => {
    expect(existsSync("app/(age-confirm)/confirm-age/page.tsx")).toBe(true);
    expect(existsSync("app/(portal)/confirm-age")).toBe(false);
  });

  it("the portal layout sends unconfirmed accounts there before the two-factor gate", () => {
    const layout = readFileSync("app/(portal)/layout.tsx", "utf8");
    const age = layout.indexOf("if (!confirmedAge) {");
    expect(age).toBeGreaterThan(-1);
    expect(layout.indexOf('if (gate === "required") {')).toBeGreaterThan(age);
    expect(layout).toContain("redirect(`${AGE_CONFIRM_PATH}");
  });
});
