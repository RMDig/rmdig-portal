import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Baseline security headers applied to every response. Defense-in-depth:
// these don't prevent application bugs, but they shrink the blast radius of
// many class-of-bug exploits (clickjacking, MIME sniffing, referrer leaks).
//
// Content-Security-Policy is a baseline only: the three directives below are
// safe against every route (none of them restricts what the page may load or
// run). A full policy with a nonce-based script-src needs per-route care
// (Next.js inline boot scripts, Sentry endpoints, Vercel Live preview
// comments, MapLibre tile servers and workers) and follows separately
// (beta blocker plan, B6). frame-ancestors is the CSP successor of
// X-Frame-Options; both are sent for older browsers.
//
// Strict-Transport-Security is only set in production — local dev runs http.
const baselineContentSecurityPolicy = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

const securityHeaders = [
  { key: "Content-Security-Policy", value: baselineContentSecurityPolicy },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self)",
  },
];

const productionOnlyHeaders =
  process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : [];

const nextConfig: NextConfig = {
  // The ad target picker's admin selector + readable-target labels read the bundled
  // Census reference data (lib/geo/data/*.json) at runtime via node:fs (AD-P7b). Force
  // those files into the deployment for the routes that touch them, so Vercel's file
  // tracing doesn't omit a fs.readFileSync it can't statically follow.
  outputFileTracingIncludes: {
    "/api/geo/**": ["./lib/geo/data/**"],
    "/advertiser/**": ["./lib/geo/data/**"],
    "/admin/**": ["./lib/geo/data/**"],
  },
  experimental: {
    serverActions: {
      // Next's default is 1 MB, below a typical scanned proof document: a SAR
      // application with a larger letter got the error page instead of a field
      // error (2026-10-08). 4.5 MB is Vercel's own function request limit, so nothing larger
      // could arrive anyway. The document cap (lib/blob/proof-limits.ts) leaves
      // room under it for the rest of the form; a unit test pins the two.
      bodySizeLimit: "4.5mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, ...productionOnlyHeaders],
      },
    ];
  },
  // Legacy URLs from the pre-2026-07-25 marketing site (Render), still in
  // Google's index and in press coverage. /snowpack_dataset survives as a real
  // page at its exact old path; the rest map to their nearest successor so no
  // indexed or press-linked URL 404s. Permanent: search engines should
  // consolidate onto the targets.
  async redirects() {
    return [
      // /avai is a real page again (2026-07-27) — no redirect.
      { source: "/snowgan", destination: "/research/models", permanent: true },
      { source: "/corediff", destination: "/research/models", permanent: true },
      { source: "/corediffusion", destination: "/research/models", permanent: true },
      { source: "/about", destination: "/", permanent: true },
      { source: "/projects", destination: "/research/models", permanent: true },
      // Research moved under /research (2026-10). /snowpack_dataset keeps its
      // URL: it's the brand's best-ranking page and is cited in press.
      { source: "/models", destination: "/research/models", permanent: true },
      { source: "/methods", destination: "/research/methods", permanent: true },
      // AvApp links people to rmdig.ai/account (AvApp work item 2026-10-02);
      // account management lives at /settings. Exact match only: /account/delete
      // and /account/review are real pages. Temporary, so /account stays free.
      { source: "/account", destination: "/settings", permanent: false },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Upload source maps for the wider client bundle too, so minified client-side
  // stack traces resolve to original source in Sentry (P1.5 source-maps goal).
  widenClientFileUpload: true,
});
