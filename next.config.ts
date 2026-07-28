import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Baseline security headers applied to every response. Defense-in-depth:
// these don't prevent application bugs, but they shrink the blast radius of
// many class-of-bug exploits (clickjacking, MIME sniffing, referrer leaks).
//
// Notably NOT included yet:
// - Content-Security-Policy: needs per-route care (Next.js inline boot scripts,
//   Sentry endpoints, Vercel Live preview comments, MapLibre tile servers).
//   Tracked as P1.5 polish work.
// - Strict-Transport-Security: only set in production — local dev runs http.
const securityHeaders = [
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
      { source: "/snowgan", destination: "/models", permanent: true },
      { source: "/corediff", destination: "/models", permanent: true },
      { source: "/corediffusion", destination: "/models", permanent: true },
      { source: "/about", destination: "/", permanent: true },
      { source: "/projects", destination: "/models", permanent: true },
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
