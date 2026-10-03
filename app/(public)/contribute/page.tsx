import type { Metadata } from "next";
import Link from "next/link";

import LawyerPlaceholder from "@/components/legal/LawyerPlaceholder";
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
          Submitting snowpack samples
        </h2>
        <p>
          Anyone will be able to submit snowpack samples to the{" "}
          <Link href="/snowpack_dataset" className="font-medium underline">
            open snowpack dataset
          </Link>
          . Collecting a sample takes an AvAI coring kit, which we plan to offer for sale this
          winter, and samples are submitted through the AvAI app. Submitting isn&apos;t
          available yet.
        </p>
        <p>
          We plan to pay for each accepted photo, currently expected to be about $0.01 per
          photo. A person reviews every sample, and we may reject samples that are low
          quality: for example, blurry photos, or cores not collected the way the kit
          describes. Rejected samples aren&apos;t paid for or published. Accepted photos may
          be published in the dataset under the CC&nbsp;BY&nbsp;4.0 license.
        </p>
        <LawyerPlaceholder>
          [COUNSEL] Submission and payment terms, published before submissions open: the rate,
          how and when payment is made, tax reporting, rejection and any appeal, the license
          you grant (CC BY 4.0), and withdrawal. The Terms of Service and privacy policy change
          in the same release.
        </LawyerPlaceholder>
      </section>

      <section className="mt-12 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          Building models with the dataset
        </h2>
        <p>
          Building AI models with the snowpack dataset is more than welcome. We encourage you
          to release these as open source:
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
      </section>

      <p className="mt-10 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
        Payments to rmdig are covered by our{" "}
        <Link href="/terms" className="font-medium underline">
          Terms of Service
        </Link>
        . Questions go to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </article>
  );
}
