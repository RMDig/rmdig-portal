import type { Metadata } from "next";
import Link from "next/link";

import { BETA_DISCLOSURE, OPERATOR_CONTINUITY_DISCLOSURE } from "@/lib/legal/compliance-copy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Services — check-out / check-in safety alerts and more | AvAI by RMDig",
  description:
    "What AvAI and rmdig.ai offer and how each works: check out before a backcountry trip and check in when you're back, with alerts to your emergency contact if you don't; Send Help; support for emergency contacts and search & rescue teams; open snowpack research.",
  path: "/services",
});

// Public surface (doc 16 §6.2 scan applies). Every claim here is one /avai,
// /sms or /alerts already makes; nothing new about reliability. Check-out is
// the main service (operator, 2026-10-03); the rest are supporting. Features
// that aren't live are named as not live.
const STEPS = [
  {
    title: "Check out before you go",
    body: "In the app, set the time you expect to be back and choose your emergency contact. AvAI's servers confirm the check-out; until they do, it isn't active, and the app says so.",
  },
  {
    title: "Our servers watch the clock",
    body: "Once a check-out is active, the watchdog runs on our servers, not your phone. If you allow location, the app sends it while you're out, whenever it has signal, so your last-known location stays current.",
  },
  {
    title: "Check in when you're back",
    body: "Tap check in, and once our servers receive it, the check-out ends.",
  },
  {
    title: "If you don't check in, your contact is alerted",
    body: "When your return time passes without a check-in, your emergency contact gets a text and an email with your last-known location and, where we can identify one, the local search & rescue organization for the area.",
  },
] as const;

export default function ServicesPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Services</h1>
      <div className="mt-6 space-y-12 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50 [&_h3]:font-semibold [&_h3]:text-neutral-900 dark:[&_h3]:text-neutral-50">
        <p>
          Rocky Mountain Digerati runs AvAI, a safety companion app for backcountry travel, and
          this site. Here is everything we offer and how each part works.
        </p>

        <section className="space-y-5">
          <h2>Check-out / check-in</h2>
          <p>
            Our main service. It&apos;s the old practice of telling someone where you&apos;re
            going and when you&apos;ll be back, made automatic.
          </p>
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                  {i + 1}
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p className="mt-1">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p>
            Checking out and in needs cell or internet signal. Delivery favors sending an alert
            twice over not at all, so occasional duplicates are by design. AvAI alerts the
            people you chose; it does not contact 911 or rescue services on your behalf.
          </p>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            {BETA_DISCLOSURE}
          </p>
          <p>
            More detail:{" "}
            <Link href="/avai" className="font-medium underline">
              what AvAI is, in depth
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2>Send Help</h2>
          <p>
            When you need help now, the Send Help button alerts your emergency contact
            immediately with your location, without waiting for your return time. A short window
            lets you take back an accidental tap, and an &quot;I&apos;m OK&quot; follow-up tells
            your contact if you no longer need help.
          </p>
        </section>

        <section className="space-y-3">
          <h2>For emergency contacts</h2>
          <p>
            If someone adds you as their emergency contact, you get a one-time text explaining
            what that means, and you can reply STOP at any time. If you receive an alert,{" "}
            <Link href="/alerts" className="font-medium underline">
              here&apos;s what it means and what to do
            </Link>
            . Every message we send is listed on{" "}
            <Link href="/sms" className="font-medium underline">
              the SMS program page
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2>For search &amp; rescue teams</h2>
          <p>
            Search &amp; rescue organizations apply through this portal, manage their team and
            describe their service region. Our staff verify every organization by hand before
            approving it.{" "}
            <Link href="/sign-in" className="font-medium underline">
              Open the portal
            </Link>{" "}
            to apply.
          </p>
        </section>

        <section className="space-y-3">
          <h2>Field observations</h2>
          <p>
            The app includes a capture tool for snowpack profile and core photos, the same
            method behind our open dataset. In this release, your captures stay on your phone.
          </p>
        </section>

        <section className="space-y-3">
          <h2>Open research</h2>
          <p>
            We publish an open snowpack dataset and open-source models, and research how phones
            and machine learning could help backcountry travelers. None of it is part of the app
            today.{" "}
            <Link href="/research" className="font-medium underline">
              See our research
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2>Who runs it</h2>
          <p>{OPERATOR_CONTINUITY_DISCLOSURE}</p>
          <p>
            Questions:{" "}
            <Link href="/support" className="font-medium underline">
              support
            </Link>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
