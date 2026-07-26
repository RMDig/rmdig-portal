import type { MetadataRoute } from "next";

// Crawlers get the public marketing/legal surfaces; the authed portal, API,
// and token-bearing invite/reset routes are noise (or worse) in an index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/settings",
          "/admin",
          "/sar",
          "/advertiser",
          "/api/",
          "/invite/",
          "/admin-invite/",
          "/advertiser-invite/",
          "/reset-password",
          "/verify-email",
          "/account/delete/confirm",
        ],
      },
    ],
    sitemap: "https://rmdig.ai/sitemap.xml",
  };
}
