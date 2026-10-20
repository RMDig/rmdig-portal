import { describe, expect, it } from "vitest";

import { createSubmitGuard } from "@/components/forms/single-submit";

// A quick second click can land before React re-renders the disabled button,
// and useActionState would run both. The guard drops it.
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
