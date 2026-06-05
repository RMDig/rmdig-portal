import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<{ role: string }> }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(h.rows) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  userPlatformRoles: { userId: "user_id", role: "role" },
}));

import { getPlatformRoles, hasPlatformRole, isPlatformStaff } from "@/lib/auth/roles";

beforeEach(() => {
  h.rows = [];
});

describe("platform roles helper", () => {
  it("returns an empty list for a user with no roles", async () => {
    expect(await getPlatformRoles("u1")).toEqual([]);
    expect(await isPlatformStaff("u1")).toBe(false);
  });

  it("maps rows to role names", async () => {
    h.rows = [{ role: "rmdig_admin" }, { role: "rmdig_reviewer" }];
    expect(await getPlatformRoles("u1")).toEqual(["rmdig_admin", "rmdig_reviewer"]);
  });

  it("checks membership of a specific role", async () => {
    h.rows = [{ role: "rmdig_reviewer" }];
    expect(await hasPlatformRole("u1", "rmdig_reviewer")).toBe(true);
    expect(await hasPlatformRole("u1", "rmdig_admin")).toBe(false);
  });

  it("treats any role as staff", async () => {
    h.rows = [{ role: "rmdig_reviewer" }];
    expect(await isPlatformStaff("u1")).toBe(true);
  });
});
