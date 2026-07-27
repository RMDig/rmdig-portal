import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";

export const metadata: Metadata = {
  title: "AvAI SMS program — how alerts and consent work | RMDig",
  description:
    "Opt-in evidence and program details for AvAI safety-alert text messages: how emergency-contact designation works, the exact messages sent, YES/STOP/HELP semantics, and message frequency.",
  alternates: { canonical: "/sms" },
};

// A2P 10DLC opt-in evidence page at a stable URL (carrier vetting + CTIA
// program-details reference). The quoted message texts are VERBATIM twins of
// AvServ doc 22 §2's pinned templates — if a template changes there, this
// page changes in the same release. Public-copy discipline (doc 16 §6.2
// scan) applies.
export default function SmsProgramPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">The AvAI SMS program</h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        AvAI backcountry safety alerts, operated by {LEGAL_ENTITY}.
      </p>

      <div className="mt-8 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            AvAI sends text messages for exactly one purpose: <strong>safety</strong>. An
            AvAI user designates an emergency contact; if the user misses a safety
            check-in or requests help, our servers text that contact. We send no
            marketing or promotional messages — ever.
          </p>
        </section>

        <section>
          <h2>How someone ends up receiving our messages</h2>
          <p className="mt-3">
            Inside the AvAI app, a user adds a person as their emergency contact and, as
            part of that screen, confirms they have that person&apos;s permission to share
            their contact details and have them receive safety messages. Designation — the
            user&apos;s deliberate act plus this confirmation — is the consent basis for
            the program.
          </p>
          <figure className="mt-4 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {/* SCREENSHOT SLOT: replace with the AvApp designation-screen
                capture (permission disclosure visible) once the doc 32 §9.6
                screen ships — tracked as an urgent AvApp issue. */}
            [Screenshot of the in-app emergency-contact designation screen, including the
            permission confirmation, will appear here — the screen is in active
            development.]
          </figure>
          <p className="mt-3">
            The contact then receives a <strong>one-time designation notice</strong>{" "}
            before any alert can reach them:
          </p>
          <blockquote className="mt-3 rounded-md border-l-4 border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-4 text-sm">
            AvAI: John Doe added you as their emergency contact on AvAI, a backcountry
            safety app. If they miss a safety check-in, you&apos;ll get an alert with
            their last-known location. Reply YES to confirm (optional). Message rates
            apply. Reply STOP any time to opt out — if someone is relying on you when you
            do, we&apos;ll notify them right away so they can arrange other coverage.
            Reply HELP for info.
          </blockquote>
        </section>

        <section>
          <h2>YES, STOP, and HELP</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong>YES</strong> — an optional acknowledgment. Alerts flow by default
              once a contact is designated; no confirmation is required, because a safety
              alert that waits on a reply is not a safety alert.
            </li>
            <li>
              <strong>STOP</strong> — opts the number out of all AvAI messages, including
              real safety alerts. Honored immediately and retained permanently as a
              suppression record. The user who designated the contact is notified so they
              can arrange other coverage.
            </li>
            <li>
              <strong>HELP</strong> — returns the program-details reply:
              <blockquote className="mt-2 rounded-md border-l-4 border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm">
                AvAI backcountry safety alerts by Rocky Mountain Digerati. You were added
                as someone&apos;s emergency contact. Msg rates apply. Privacy and details:
                rmdig.ai — Reply STOP to opt out.
              </blockquote>
            </li>
          </ul>
        </section>

        <section>
          <h2>Message types &amp; frequency</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>The one-time designation notice (above)</li>
            <li>A per-outing availability request, when a user lists you for a specific trip</li>
            <li>Overdue alerts — the user missed their check-in; includes last-known location</li>
            <li>Escalation and follow-up alerts while an overdue situation is unresolved</li>
            <li>All-clear notices once the user checks in safe</li>
          </ul>
          <p className="mt-3">
            <strong>Frequency varies and is entirely event-driven</strong> — messages are
            triggered only by the designating user&apos;s safety activity. Message and
            data rates may apply. Emergency alerts intentionally omit the STOP footer to
            keep life-safety content unambiguous; STOP is honored from any message at any
            time. Delivery favors sending an alert twice over not at all, so occasional
            duplicates are possible by design.
          </p>
        </section>

        <section>
          <h2>Your information &amp; the fine print</h2>
          <p className="mt-3">
            No mobile information is shared with third parties or affiliates for
            marketing or promotional purposes. What we hold about contacts and how to
            request deletion is covered in the{" "}
            <Link href="/privacy" className="font-medium underline">
              privacy policy
            </Link>{" "}
            (see &quot;Were you added as someone&apos;s emergency contact?&quot;), the
            program&apos;s contractual terms in the{" "}
            <Link href="/terms" className="font-medium underline">
              terms of service
            </Link>
            , and what to do when an alert arrives at{" "}
            <Link href="/alerts" className="font-medium underline">
              rmdig.ai/alerts
            </Link>
            . Questions:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
