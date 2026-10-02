import type { Metadata } from "next";
import Link from "next/link";

import { env } from "@/lib/env";
import { CONTRIBUTE_BODY, SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";

export const metadata: Metadata = {
  title: "Contribute — rmdig / AvAI",
  description:
    "Contribute to Rocky Mountain Digerati LLC, the company that runs AvAI. Contributions pay for the servers and the check-in watchdog.",
};

// AvApp doc 35 §4.3 / §5.1 — the canonical contribution page, phase D1.
// This is NOT /support: that URL is the store-mandated customer-support page
// whose first paragraph is the operator-continuity disclosure, and a money
// ask there would muddy it (doc 35 §4.3). Zero backend here: the button is a
// Stripe Payment Link (one-time only; recurring deferred, doc 35 §9) that the
// operator supplies as config. The body is the verbatim twin of AvApp
// lib/copy/contribute_copy.dart — never paraphrase it at this call site.
export default function ContributePage() {
  const paymentLinkUrl = env.CONTRIBUTE_PAYMENT_LINK_URL;

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Contribute to AvAI</h1>

      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">{CONTRIBUTE_BODY}</p>

      <div className="mt-10">
        {paymentLinkUrl ? (
          <>
            <a
              href={paymentLinkUrl}
              rel="noopener"
              className="inline-block rounded-md bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Contribute
            </a>
            <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
              One-time contribution, processed by Stripe on a Stripe-hosted checkout page.
            </p>
          </>
        ) : (
          // Operator has not configured the Payment Link yet (LLC Stripe
          // account pending — doc 35 §8 D1 gate). Visible, not silent; promises
          // no timeline.
          <p className="rounded-md border border-neutral-200 px-4 py-3 text-neutral-700 dark:border-neutral-800 dark:text-neutral-200">
            Contributions aren&apos;t open yet.
          </p>
        )}
      </div>

      <section className="mt-12 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          Snowpack samples and the open dataset
        </h2>
        <p>
          Over the long term, we plan to let anyone submit snowpack samples to grow the{" "}
          <Link href="/snowpack_dataset" className="font-medium underline">
            open snowpack dataset
          </Link>
          . That feature is still in development and isn&apos;t available yet.
        </p>
        <p>
          Building AI models with the snowpack dataset is more than welcome. We ask two things:
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Models not meant for safety decisions</strong> (research, education,
            exploration): we encourage you to release them as open source, for transparency,
            especially models that show a validated advantage from pre-training on this data,
            so others can build on them.
          </li>
          <li>
            <strong>Models meant to inform safety decisions</strong> in avalanche terrain are
            welcome too, but we recommend having them verified by peers before you release
            them.
          </li>
        </ul>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          These are requests from us, not license terms: the dataset&apos;s own license governs
          how it may be used.
        </p>
      </section>

      <p className="mt-10 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
        Contributions are covered by our{" "}
        <Link href="/terms" className="font-medium underline">
          Terms of Service
        </Link>
        . Questions about a contribution go to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </article>
  );
}
