import { describe, expect, it } from "vitest";

import { createSubmitGuard } from "@/components/forms/single-submit";

// Two reset codes one second apart in production (2026-10-20): a second click
// landed before React re-rendered the disabled button. The guard drops it.
describe("createSubmitGuard", () => {
  it("lets the first submit through and drops the next until it finishes", () => {
    const g = createSubmitGuard();
    expect(g.tryStart()).toBe(true);
    expect(g.tryStart()).toBe(false);
    expect(g.tryStart()).toBe(false);
    g.done();
    expect(g.tryStart()).toBe(true);
  });

  it("starts open", () => {
    expect(createSubmitGuard().tryStart()).toBe(true);
  });
});
