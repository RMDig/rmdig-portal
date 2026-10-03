import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
