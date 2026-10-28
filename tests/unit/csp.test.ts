import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCsp, MAINTENANCE_CSP, makeNonce, sentryReportUri } from "@/lib/csp";

// Plan 36 H1: the nonce-based policy, shipped Report-Only first (S-D9).

const DSN = "https://abc123@o42.ingest.us.sentry.io/4507";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

describe("buildCsp", () => {
  const base = { nonce: "bm9uY2U=", dev: false, sentryDsn: DSN };

  it("allows scripts only by nonce, with strict-dynamic and no eval or inline", () => {
    const script = directives(buildCsp(base)).get("script-src");
    expect(script).toEqual(["'self'", "'nonce-bm9uY2U='", "'strict-dynamic'"]);
  });

  it("lets the map and Sentry connect, and nothing else off-site", () => {
    const d = directives(buildCsp(base));
    expect(d.get("connect-src")).toEqual([
      "'self'",
      "https://api.maptiler.com",
      "https://tile.openstreetmap.org",
      "https://o42.ingest.us.sentry.io",
    ]);
    expect(d.get("img-src")).toEqual(["'self'", "data:", "blob:", "https://api.maptiler.com", "https://tile.openstreetmap.org"]);
    expect(d.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(d.get("default-src")).toEqual(["'self'"]);
  });

  it("keeps the enforced baseline directives and allows the Google sign-in redirect", () => {
    const d = directives(buildCsp(base));
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'", "https://accounts.google.com"]);
  });

  it("adds eval and the HMR websocket only in dev", () => {
    const d = directives(buildCsp({ ...base, dev: true }));
    expect(d.get("script-src")).toContain("'unsafe-eval'");
    expect(d.get("connect-src")).toContain("ws:");
  });

  it("reports only when given a report URI", () => {
    expect(buildCsp(base)).not.toMatch(/report-/);
    const d = directives(buildCsp({ ...base, reportUri: "https://r.example/x" }));
    expect(d.get("report-uri")).toEqual(["https://r.example/x"]);
    expect(d.get("report-to")).toEqual(["csp"]);
  });

  it("leaves Sentry out when there is no usable DSN", () => {
    for (const sentryDsn of [undefined, "not a url", "http://k@o1.ingest.sentry.io/1", "https://o1.ingest.sentry.io/1"]) {
      expect(buildCsp({ ...base, sentryDsn })).not.toMatch(/sentry/);
    }
  });
});

describe("sentryReportUri", () => {
  it("builds Sentry's security endpoint from the DSN", () => {
    expect(sentryReportUri(DSN, "production", "86cc27a")).toBe(
      "https://o42.ingest.us.sentry.io/api/4507/security/?sentry_key=abc123&sentry_environment=production&sentry_release=86cc27a",
    );
  });

  it("is undefined without a DSN", () => {
    expect(sentryReportUri(undefined)).toBeUndefined();
  });
});

describe("makeNonce", () => {
  it("is 16 random bytes, base64, different each time", () => {
    const a = makeNonce();
    expect(atob(a)).toHaveLength(16);
    expect(makeNonce()).not.toBe(a);
  });
});

describe("maintenance page policy", () => {
  it("runs no script and loads nothing off-site", () => {
    const d = directives(MAINTENANCE_CSP);
    expect(d.get("default-src")).toEqual(["'none'"]);
    expect(d.has("script-src")).toBe(false);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
  });
});

describe("middleware CSP headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load() {
    return (await import("@/middleware")).middleware;
  }

  function req(path: string) {
    const u = new URL(`https://rmdig.ai${path}`);
    return new NextRequest(u, { headers: { host: u.host } });
  }

  it("enforces one policy and hands Next the same nonce, new per request", async () => {
    const middleware = await load();
    const a = await middleware(req("/privacy"));
    const csp = a.headers.get("Content-Security-Policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    // One policy only: a second CSP header would replace the nonce on Vercel.
    expect(a.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    // Next reads the nonce from the request side under the enforced name.
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(a.headers.get("x-middleware-request-content-security-policy-report-only")).toBeNull();
    const b = await middleware(req("/settings"));
    expect(b.headers.get("Content-Security-Policy")).not.toBe(csp);
  });

  it("reports to Sentry from production only", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("VERCEL_ENV", "preview");
    let res = await (await load())(req("/"));
    expect(res.headers.get("Content-Security-Policy")).not.toMatch(/report-uri/);
    expect(res.headers.get("Reporting-Endpoints")).toBeNull();

    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "86cc27a");
    res = await (await load())(req("/"));
    const uri = sentryReportUri(DSN, "production", "86cc27a");
    expect(res.headers.get("Content-Security-Policy")).toContain(`report-uri ${uri}`);
    expect(res.headers.get("Reporting-Endpoints")).toBe(`csp="${uri}"`);
  });

  it("adds no policy to the legacy-host redirect", async () => {
    const res = await (await load())(new NextRequest("https://app.rmdig.ai/", { headers: { host: "app.rmdig.ai" } }));
    expect(res.status).toBe(308);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });
});
