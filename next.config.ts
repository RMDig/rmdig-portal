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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...securityHeaders, ...productionOnlyHeaders],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
