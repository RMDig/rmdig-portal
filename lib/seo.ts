import type { Metadata } from "next";

// One place that builds a public page's search and link-preview metadata.
// Next.js replaces (does not merge) a parent's openGraph/twitter objects when
// a page sets its own, so every page gets the full set from here, including
// the preview image: app/opengraph-image.tsx belongs to the root segment, and
// a page-level openGraph would otherwise drop it.
export const SITE_NAME = "RMDig · AvAI";

const PREVIEW_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "AvAI by Rocky Mountain Digerati: check out with peace of mind",
};

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title,
      description,
      images: [PREVIEW_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [PREVIEW_IMAGE.url] },
  };
}
