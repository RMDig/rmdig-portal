import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

// Beta blocker B6: every response carries the baseline CSP alongside the
// legacy framing header. The directives are deliberately limited to ones that
// can't break a route (no script-src/default-src yet), so the test pins the
// exact value: widening it is a reviewed change, not drift.

async function headersFor(source: string): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  if (!rule) throw new Error(`no header rule for ${source}`);
  return new Map(rule.headers.map((h) => [h.key, h.value]));
}

describe("security headers", () => {
  it("applies the baseline Content-Security-Policy to every path", async () => {
    const headers = await headersFor("/:path*");
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    );
  });

  it("keeps X-Frame-Options and nosniff for browsers without CSP framing support", async () => {
    const headers = await headersFor("/:path*");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("does not restrict scripts yet (a nonce policy needs per-route work)", async () => {
    const csp = (await headersFor("/:path*")).get("Content-Security-Policy") ?? "";
    expect(csp).not.toMatch(/script-src|default-src/);
  });
});
