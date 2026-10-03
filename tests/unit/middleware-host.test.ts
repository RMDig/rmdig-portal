import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

// Session cookies are host-scoped, so exactly ONE browsing host may exist:
// legacy hosts 308 to the canonical apex (preserving path, query, and — by
// 308 semantics — method/body for API and store-registered URLs), while the
// apex and non-production hosts (previews, localhost) pass through untouched.

function req(url: string): NextRequest {
  const u = new URL(url);
  return new NextRequest(u, { headers: { host: u.host } });
}

describe("canonical-host middleware", () => {
  it("308s app.rmdig.ai to the apex, preserving path and query", async () => {
    const res = await middleware(req("https://app.rmdig.ai/privacy?x=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://rmdig.ai/privacy?x=1");
  });

  it("308s www.rmdig.ai to the apex", async () => {
    const res = await middleware(req("https://www.rmdig.ai/account/delete"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://rmdig.ai/account/delete");
  });

  it("passes the apex through and forwards x-pathname", async () => {
    const res = await middleware(req("https://rmdig.ai/settings"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    // NextResponse.next({request}) carries the overridden request headers here.
    expect(res.headers.get("x-middleware-request-x-pathname")).toBe("/settings");
  });

  it("leaves preview/local hosts alone (e2e runs on *.vercel.app)", async () => {
    for (const host of ["rmdig-portal-abc123.vercel.app", "localhost:3000"]) {
      const res = await middleware(req(`https://${host}/sign-in`));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
