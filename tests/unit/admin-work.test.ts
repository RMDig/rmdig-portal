import { describe, expect, it, vi } from "vitest";

// Whether /admin has anything for a set of roles; the header's Admin link and
// the admin page's own redirect both follow it.

vi.mock("@/lib/db", () => ({ db: {} }));

import { hasAdminWork } from "@/lib/auth/admin-work";

const OFF = { adsOn: false, reviewsOn: false };

describe("hasAdminWork", () => {
  it("is false without a platform role, whatever is switched on", () => {
    expect(hasAdminWork([], { adsOn: true, reviewsOn: true })).toBe(false);
  });

  it("is true for an admin or a SAR approver", () => {
    expect(hasAdminWork(["rmdig_admin"], OFF)).toBe(true);
    expect(hasAdminWork(["rmdig_sar_approver"], OFF)).toBe(true);
  });

  it("is false for a Reviewer while the ad queue and restriction reviews are off", () => {
    expect(hasAdminWork(["rmdig_reviewer"], OFF)).toBe(false);
  });

  it("is true for a Reviewer once the ad queue or restriction reviews are on", () => {
    expect(hasAdminWork(["rmdig_reviewer"], { adsOn: true, reviewsOn: false })).toBe(true);
    expect(hasAdminWork(["rmdig_reviewer"], { adsOn: false, reviewsOn: true })).toBe(true);
  });
});
