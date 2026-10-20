import { afterEach, describe, expect, it, vi } from "vitest";

// lib/zod-browser.ts: in the browser Zod must never reach for eval, which the
// CSP forbids (lib/csp.ts). Each test file gets fresh modules, so Zod's cached
// eval probe starts unset here.

describe("zod in the browser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates objects without calling Function once jitless is set", async () => {
    await import("@/lib/zod-browser");
    const { z } = await import("zod");
    const fn = vi.fn(Function);
    vi.stubGlobal("Function", fn);

    const schema = z.object({ email: z.string().email(), count: z.number().int() });
    expect(schema.safeParse({ email: "a@example.org", count: 2 }).success).toBe(true);
    expect(schema.safeParse({ email: "nope", count: 2.5 }).error?.issues).toHaveLength(2);
    expect(fn).not.toHaveBeenCalled();
    expect(z.config().jitless).toBe(true);
  });
});
