import type { MetadataRoute } from "next";

// The indexable public surface. Keep in step with app/(public)/ — a page
// missing here still gets crawled via links, but the sitemap is what we hand
// Search Console after the 2026-07 domain cutover to re-anchor the index.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://rmdig.ai";
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/snowpack_dataset`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/models`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/methods`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/support`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/alerts`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/sms`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/terms`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/account/delete`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
