import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The portal layout redirects a user who must turn on two-factor to
// /settings/mfa/enroll. Next reuses a layout across client navigations without
// rendering it again, so an enroll page inside that layout was reached with
// the redirect still in the browser: after sign-in the browser fetched it
// without end and showed a blank page (2026-11-13). The page lives under its
// own layout (app/(mfa-enroll)/layout.tsx); this keeps it there.

describe("two-factor enrollment page placement", () => {
  it("is outside the portal layout that redirects to it", () => {
    expect(existsSync("app/(mfa-enroll)/settings/mfa/enroll/page.tsx")).toBe(true);
    expect(existsSync("app/(portal)/settings/mfa/enroll")).toBe(false);
  });

  it("the portal layout redirects without an exemption for the enroll path", () => {
    const layout = readFileSync("app/(portal)/layout.tsx", "utf8");
    expect(layout).toContain('if (gate === "required") {');
    expect(layout).not.toMatch(/pathname !== ENROLL_PATH/);
  });
});
