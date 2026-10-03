import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// rmdig.ai/account is linked from AvApp; it must land on /settings without
// shadowing the real /account/delete and /account/review pages.

const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

describe("/account redirect", () => {
  it("sends /account (exact) to /settings, temporarily", () => {
    expect(config).toContain('{ source: "/account", destination: "/settings", permanent: false }');
  });

  it("does not use a wildcard that would swallow /account/delete or /account/review", () => {
    expect(config).not.toMatch(/source: "\/account\/:/);
  });
});
