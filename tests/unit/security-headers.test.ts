import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

// Static headers on every response. The CSP is deliberately NOT one of them:
// middleware.ts sends it with a per-request nonce (tests/unit/csp.test.ts),
// and on Vercel a static CSP here is copied onto the request and replaces the
// nonce one before the render (2026-10-20).

async function headersFor(source: string): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  if (!rule) throw new Error(`no header rule for ${source}`);
  return new Map(rule.headers.map((h) => [h.key, h.value]));
}

describe("security headers", () => {
  it("sets no Content-Security-Policy statically (it would replace the nonce on Vercel)", async () => {
    const headers = await headersFor("/:path*");
    expect([...headers.keys()].filter((k) => /content-security-policy/i.test(k))).toEqual([]);
  });

  it("keeps X-Frame-Options and nosniff for every path, including those middleware skips", async () => {
    const headers = await headersFor("/:path*");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
