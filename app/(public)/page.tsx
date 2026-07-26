import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  BETA_DISCLOSURE,
  OPERATOR_CONTINUITY_DISCLOSURE,
} from "@/lib/legal/compliance-copy";

export const metadata: Metadata = {
  title: "AvAI (Avalanche AI) — backcountry safety companion | RMDig",
  description:
    "AvAI by Rocky Mountain Digerati: a beta safety companion app for backcountry travel — check out before a trip, check in when you're back safe — plus open snowpack research and the Rocky Mountain Snowpack dataset.",
  alternates: { canonical: "/" },
};

// Search-engine identity card (Organization schema): ties the brand, the
// legal entity, and the public research profile together for crawlers.
const ORG_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Rocky Mountain Digerati LLC",
  alternateName: ["RMDig", "AvAI", "Avalanche AI"],
  url: "https://rmdig.ai",
  logo: "https://rmdig.ai/rmdig-logo.png",
  email: "support@rmdig.ai",
  sameAs: [
    "https://huggingface.co/RMDig",
    "https://huggingface.co/datasets/RMDig/rocky_mountain_snowpack",
    "https://github.com/dennys246",
  ],
};

// The public landing page. Copy here is a PUBLIC-FACING SURFACE under AvApp
// doc 16 §6.2 — the forbidden-phrase scan in tests/unit/legal-copy.test.ts
// covers this file. Claim only what the current beta rung delivers.
export default function LandingPage() {
  return (
    <div className="mx-auto max-w-4xl px-4">
      <section className="flex flex-col items-center py-16 text-center sm:py-24">
        {/* 600×384 sources at 128px tall — 3x for retina crispness. Theme
            pair: the black mark disappears on a dark background, so each
            variant renders only in its matching color scheme (dark: follows
            prefers-color-scheme). */}
        <Image
          src="/avai-logo.png"
          alt="AvAI"
          width={200}
          height={128}
          priority
          className="dark:hidden"
        />
        <Image
          src="/avai-logo-white.png"
          alt="AvAI"
          width={200}
          height={128}
          priority
          className="hidden dark:block"
        />
        <h1 className="mt-6 tracking-tight">
          <span className="block text-4xl font-semibold sm:text-5xl">Check Out</span>
          <span className="text-muted-foreground my-1 block text-xl font-normal italic sm:text-2xl">
            with
          </span>
          <span className="block text-4xl font-semibold sm:text-5xl">Peace of Mind</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-600 dark:text-neutral-300">
          A safety companion for backcountry travel: check out before you head into the
          field, and check in when you&apos;re back safe. If you don&apos;t check in on
          time, AvAI&apos;s servers alert your emergency contact with your last-known
          location.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link
            href="/sign-in"
            className="rounded-md bg-neutral-900 dark:bg-white px-5 py-2.5 font-medium text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-neutral-200"
          >
            Open the portal
          </Link>
          <Link
            href="/support"
            className="rounded-md border border-neutral-300 dark:border-neutral-700 px-5 py-2.5 font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            Support
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-5">
        <h2 className="font-semibold text-amber-900 dark:text-amber-200">AvAI™ is in beta</h2>
        <p className="mt-2 text-amber-900 dark:text-amber-200">{BETA_DISCLOSURE}</p>
      </section>

      <section className="grid gap-8 py-16 sm:grid-cols-3">
        <div>
          <h2 className="font-semibold">Check out / check in</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            Schedule a check-in before a trip. A server-side watchdog watches the clock —
            if the check-in time passes without word from you, your emergency contact gets
            an alert with your last-known location. Requires cell or internet signal to
            check out and in — emergency alerts are sent by our servers regardless of your
            connectivity.
          </p>
        </div>
        <div>
          <h2 className="font-semibold">Field observations</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            Capture snowpack profile and core photos in the field. At this stage of the
            beta, photos stay on your device.
          </p>
        </div>
        <div>
          <h2 className="font-semibold">Search &amp; rescue orgs</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
            SAR organizations onboard through this portal to manage their teams and service
            regions.
          </p>
        </div>
      </section>

      <section className="border-t border-neutral-200 dark:border-neutral-800 py-12">
        <h2 className="font-semibold">Open snowpack research</h2>
        <p className="mt-3 max-w-3xl leading-7 text-neutral-600 dark:text-neutral-300">
          AvAI is short for <strong>Avalanche AI</strong>: alongside the app, we publish
          the open{" "}
          <Link href="/snowpack_dataset" className="font-medium underline">
            Rocky Mountain Snowpack dataset
          </Link>{" "}
          (CC-BY-4.0) and{" "}
          <Link href="/models" className="font-medium underline">
            open-source snowpack models
          </Link>
          , and research avalanche-risk modeling on snowpack imagery. The research is in
          development and is not part of the app today.
        </p>
      </section>

      <section className="border-t border-neutral-200 dark:border-neutral-800 py-12">
        <h2 className="font-semibold">Who runs AvAI?</h2>
        <p className="mt-3 max-w-3xl leading-7 text-neutral-600 dark:text-neutral-300">
          {OPERATOR_CONTINUITY_DISCLOSURE}
        </p>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSONLD) }}
      />
    </div>
  );
}
