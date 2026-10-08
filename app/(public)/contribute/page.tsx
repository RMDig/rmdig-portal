import type { Metadata } from "next";
import Link from "next/link";

import { CONTRIBUTE_BODY, SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Contribute — rmdig / AvAI",
  description:
    "Contributing to Rocky Mountain Digerati LLC, the company that runs AvAI, and building on the open snowpack dataset.",
  path: "/contribute",
});

// AvApp doc 35 §4.3 / §5.1 — the page AvApp's "Contribute on rmdig.ai" button
// opens (kContributeUrl). Minimal by decision D3 (beta blocker plan): static,
// no session, no DB, no env. The doc 35 D1 Stripe Payment Link waits for the
// LLC's Stripe account, so the page states plainly that contributions aren't
// open rather than showing a button. This is NOT /support: that URL is the
// store-mandated support page, and a money ask there would muddy it (doc 35
// §4.3). The body is the verbatim twin of AvApp lib/copy/contribute_copy.dart
// `kContributeBody` — never paraphrase it at this call site.
export default function ContributePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Contribute to AvAI</h1>

      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">{CONTRIBUTE_BODY}</p>

      {/* Visible, not silent; promises no timeline. */}
      <p className="mt-10 rounded-md border border-neutral-200 px-4 py-3 text-neutral-700 dark:border-neutral-800 dark:text-neutral-200">
        Contributions aren&apos;t open yet.
      </p>

      <section className="mt-12 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          Building models with the dataset
        </h2>
        <p>
          Building AI models with the{" "}
          <Link href="/snowpack_dataset" className="font-medium underline">
            open snowpack dataset
          </Link>{" "}
          is more than welcome. We encourage you to release these as open source:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Models not meant for safety decisions</strong> (research, education,
            exploration), for transparency.
          </li>
          <li>
            <strong>Models that show a validated advantage from pre-training</strong> on this
            data, so others can build on them.
          </li>
        </ul>
        <p>
          <strong>Models meant to inform safety decisions</strong> in avalanche terrain are
          welcome too, but we recommend having them peer-reviewed by independent experts before
          you release them.
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          These are requests from us, not license terms: the dataset&apos;s own license governs
          how it may be used.
        </p>
        <p>
          We hold our own models to the same standard. We release our models that aren&apos;t
          meant for safety decisions as open source. Safety models we train will be released
          only after independent experts have peer-reviewed them, and we plan to publish that
          work as a research paper.
        </p>
        <p>Submitting snowpack samples to the dataset isn&apos;t available yet.</p>
      </section>

      <p className="mt-10 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
        Questions go to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </article>
  );
}
