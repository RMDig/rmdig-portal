import type { Metadata } from "next";
import Link from "next/link";

import {
  BETA_DISCLOSURE,
  OPERATOR_CONTINUITY_DISCLOSURE,
  SUPPORT_EMAIL,
} from "@/lib/legal/compliance-copy";
import { pageMetadata } from "@/lib/seo";
import { STATUS_PAGE_URL } from "@/lib/status-page";

export const metadata: Metadata = pageMetadata({
  title: "Support — rmdig / AvAI",
  description:
    "Support and contact for the AvAI app and the rmdig portal.",
  path: "/support",
});

// This is the App Store Connect / Play Console support URL. AvApp doc 02
// P0-13 requires the operator-continuity disclosure (doc 16 §6.1, verbatim)
// as the FIRST paragraph — keep it directly under the h1, before anything
// else, and never paraphrase it.
export default function SupportPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Support</h1>

      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">{OPERATOR_CONTINUITY_DISCLOSURE}</p>

      <div className="mt-10 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section>
          <h2>Contact us</h2>
          <p className="mt-3">
            Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>{" "}
            for help with the app, your account, an alert that fired, or anything else.
            We&apos;re a small team: expect a reply within a few business days, sometimes
            longer. If someone may be in danger right now, contact your local emergency
            services or search &amp; rescue directly — support email is not an emergency
            channel.
          </p>
        </section>

        <section>
          <h2>About the current beta</h2>
          <p className="mt-3">{BETA_DISCLOSURE}</p>
          <p className="mt-3">
            AvAI is currently distributed through TestFlight and Play Internal testing. If
            service is interrupted, armed check-outs may not be watched during the outage —
            fall back to your second safety plan.
          </p>
          <p className="mt-3">
            To check whether the AvAI website and alert servers are up right now, see the{" "}
            <a href={STATUS_PAGE_URL} className="font-medium underline">
              status page
            </a>
            .
          </p>
        </section>

        <section>
          <h2>Your data</h2>
          <p className="mt-3">
            The{" "}
            <Link href="/privacy" className="font-medium underline">
              Privacy Policy
            </Link>{" "}
            describes what we collect and why. You can{" "}
            <Link href="/account/delete" className="font-medium underline">
              request deletion of your data
            </Link>{" "}
            at any time, with or without a portal account.
          </p>
        </section>
      </div>
    </article>
  );
}
