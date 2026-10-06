import { describe, expect, it } from "vitest";

import { nextQuery, safeReturnTo } from "@/lib/auth/return-to";

describe("safeReturnTo", () => {
  it("keeps a same-site path, query included", () => {
    expect(safeReturnTo("/invite/abc123")).toBe("/invite/abc123");
    expect(safeReturnTo("/account/review?restriction=r1")).toBe("/account/review?restriction=r1");
  });

  it("refuses anything that could leave the site or loop back into sign-in", () => {
    for (const bad of [
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "dashboard",
      "/sign-in?next=/x",
      "/sign-up",
      "/a\nb",
      "/a\\b",
      "",
      "/" + "a".repeat(600),
      undefined,
      42,
    ]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });

  it("builds the next= query only for a safe path", () => {
    expect(nextQuery("/invite/x")).toBe("?next=%2Finvite%2Fx");
    expect(nextQuery("/invite/x", "&")).toBe("&next=%2Finvite%2Fx");
    expect(nextQuery("//evil")).toBe("");
    expect(nextQuery(null)).toBe("");
  });
});
