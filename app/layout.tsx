import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Canonical host for absolute OG/canonical URL resolution (rmdig.ai since
  // the 2026-07-25 cutover; middleware 308s the legacy hosts onto it).
  metadataBase: new URL("https://rmdig.ai"),
  title: {
    default: "RMDig — AvAI backcountry safety companion",
    template: "%s",
  },
  description:
    "Rocky Mountain Digerati builds AvAI (Avalanche AI): a beta backcountry safety companion app, open snowpack research, and the Rocky Mountain Snowpack dataset.",
  applicationName: "AvAI",
  publisher: "Rocky Mountain Digerati LLC",
  // Defaults for pages that don't set their own (public pages use
  // lib/seo.ts pageMetadata, which sets the full set).
  openGraph: { type: "website", siteName: "RMDig · AvAI", locale: "en_US" },
  twitter: { card: "summary_large_image" },
};

// Every page renders per request, because Next can only put the per-request
// CSP nonce (middleware.ts) on scripts in a page it renders then: a prerendered
// page's scripts would carry none and be blocked once the policy is enforced
// (owner decision S-D10). Public pages stay DB-free (CLAUDE.md §3.7).
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
