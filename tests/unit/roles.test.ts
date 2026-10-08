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

import { canReviewAds, getPlatformRoles, hasPlatformRole, isPlatformStaff, isSarApprover, PLATFORM_ROLE_LABEL } from "@/lib/auth/roles";

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

  it("decides SAR orgs only with rmdig_sar_approver: admin or reviewer alone isn't enough", async () => {
    h.rows = [{ role: "rmdig_admin" }, { role: "rmdig_reviewer" }];
    expect(await isSarApprover("u1")).toBe(false);
    h.rows = [{ role: "rmdig_sar_approver" }];
    expect(await isSarApprover("u1")).toBe(true);
    expect(PLATFORM_ROLE_LABEL.rmdig_sar_approver).toBe("SAR Approver");
  });

  it("reviews ads with rmdig_admin or rmdig_reviewer, not as a SAR approver alone", async () => {
    h.rows = [{ role: "rmdig_sar_approver" }];
    expect(await canReviewAds("u1")).toBe(false);
    h.rows = [{ role: "rmdig_reviewer" }];
    expect(await canReviewAds("u1")).toBe(true);
    h.rows = [{ role: "rmdig_admin" }];
    expect(await canReviewAds("u1")).toBe(true);
  });
});
