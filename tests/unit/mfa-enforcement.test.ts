import { describe, expect, it } from "vitest";

import { evaluateMfaGate } from "@/lib/auth/mfa-enforcement";

describe("evaluateMfaGate", () => {
  it("is always ok once MFA is enabled", () => {
    for (const enforcement of ["optional", "admin_only", "all"] as const) {
      for (const isStaff of [true, false]) {
        expect(evaluateMfaGate({ enforcement, mfaEnabled: true, isStaff, isOrgAdmin: false })).toBe("ok");
      }
    }
  });

  it("optional never pushes enrollment", () => {
    expect(evaluateMfaGate({ enforcement: "optional", mfaEnabled: false, isStaff: true, isOrgAdmin: false })).toBe("ok");
    expect(evaluateMfaGate({ enforcement: "optional", mfaEnabled: false, isStaff: false, isOrgAdmin: false })).toBe("ok");
  });

  it("admin_only requires staff, nags everyone else", () => {
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: true, isOrgAdmin: false })).toBe(
      "required",
    );
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: false, isOrgAdmin: false })).toBe(
      "nag",
    );
  });

  it("all requires everyone", () => {
    expect(evaluateMfaGate({ enforcement: "all", mfaEnabled: false, isStaff: true, isOrgAdmin: false })).toBe(
      "required",
    );
    expect(evaluateMfaGate({ enforcement: "all", mfaEnabled: false, isStaff: false, isOrgAdmin: false })).toBe(
      "required",
    );
  });

  it("doesn't nag a Google-only account, whose sign-in never asks for the code, but still requires staff and team admins", () => {
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: false, isOrgAdmin: false, hasPassword: false })).toBe("ok");
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: true, isOrgAdmin: false, hasPassword: false })).toBe("required");
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: false, isOrgAdmin: true, hasPassword: false })).toBe("required");
    expect(evaluateMfaGate({ enforcement: "all", mfaEnabled: false, isStaff: false, isOrgAdmin: false, hasPassword: false })).toBe("required");
  });

  it("requires SAR org admins to enroll under admin_only, like staff", () => {
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: false, isOrgAdmin: true })).toBe("required");
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: true, isStaff: false, isOrgAdmin: true })).toBe("ok");
    expect(evaluateMfaGate({ enforcement: "optional", mfaEnabled: false, isStaff: false, isOrgAdmin: true })).toBe("ok");
  });
});
