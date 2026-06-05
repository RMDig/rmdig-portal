import { describe, expect, it } from "vitest";

import { evaluateMfaGate } from "@/lib/auth/mfa-enforcement";

describe("evaluateMfaGate", () => {
  it("is always ok once MFA is enabled", () => {
    for (const enforcement of ["optional", "admin_only", "all"] as const) {
      for (const isStaff of [true, false]) {
        expect(evaluateMfaGate({ enforcement, mfaEnabled: true, isStaff })).toBe("ok");
      }
    }
  });

  it("optional never pushes enrollment", () => {
    expect(evaluateMfaGate({ enforcement: "optional", mfaEnabled: false, isStaff: true })).toBe("ok");
    expect(evaluateMfaGate({ enforcement: "optional", mfaEnabled: false, isStaff: false })).toBe("ok");
  });

  it("admin_only requires staff, nags everyone else", () => {
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: true })).toBe(
      "required",
    );
    expect(evaluateMfaGate({ enforcement: "admin_only", mfaEnabled: false, isStaff: false })).toBe(
      "nag",
    );
  });

  it("all requires everyone", () => {
    expect(evaluateMfaGate({ enforcement: "all", mfaEnabled: false, isStaff: true })).toBe(
      "required",
    );
    expect(evaluateMfaGate({ enforcement: "all", mfaEnabled: false, isStaff: false })).toBe(
      "required",
    );
  });
});
