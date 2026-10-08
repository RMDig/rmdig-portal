import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";
import {
  CONTACT_PERMISSION_ATTESTATION,
  CONTACT_SMS_DISCLOSURE,
  DESIGNATION_NOTICE,
  HELP_REPLY,
  YES_CONFIRMATION,
} from "@/lib/legal/sms-program-copy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "AvAI SMS program — how alerts and consent work | RMDig",
  description:
    "Opt-in evidence and program details for AvAI safety-alert text messages: how emergency-contact designation works, the exact messages sent, YES/STOP/HELP semantics, and message frequency.",
  path: "/sms",
});

// A2P 10DLC opt-in evidence page at a stable URL (carrier vetting + CTIA
// program-details reference), linked from the approved campaign. Quoted
// program messages must match the campaign as Twilio holds it (AvServ
// docs/a2p/approved-campaign-2026-07-28.md); the designation notice renders
// from lib/legal/sms-program-copy.ts so both places on this page stay
// verbatim. Public-copy discipline (doc 16 §6.2 scan) applies.
// The program's sending number (Twilio long code) — shown as the sender label
// in the conversation figure so carrier reviewers see the real number type.
const SMS_SENDER_NUMBER = "+1 (720) 780-9044";

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
            Inside the AvAI app, a user adds a person as their emergency contact and, on
            that screen, must tick an unchecked box confirming they have that person&apos;s
            permission. Next to the box, the screen states what the contact will receive:
            &ldquo;{CONTACT_SMS_DISCLOSURE}&rdquo; The contact can&apos;t be saved until
            the box is ticked. Designation — the user&apos;s deliberate act plus this
            confirmation — is the consent basis for the program.
          </p>
          <figure className="mt-4 flex flex-col items-center">
            {/* A static screenshot of the AvApp Add Contact screen (fixture
                data), copied from AvApp main docs/screenshots/
                add_contact_attestation.png (2026-10-01, 987465e; AvServ account
                contract §3.8). That capture still shows the earlier disclosure
                with "automatic accident alerts": retake it in the release that
                ships the narrowed CONTACT_SMS_DISCLOSURE. Never an HTML
                checkbox here: a form-like mock is reviewed as a web opt-in
                form (Twilio 30925 lesson). */}
            <Image
              src="/research/designation-attestation.png"
              alt={`Screenshot of the AvAI Add contact screen: name and phone fields, an unticked checkbox labelled "${CONTACT_PERMISSION_ATTESTATION}", the disclosure "${CONTACT_SMS_DISCLOSURE}", and a Save contact button that stays disabled until the box is ticked.`}
              width={300}
              height={613}
              className="rounded-lg border border-neutral-200 dark:border-neutral-800"
            />
            <figcaption className="text-muted-foreground mt-2 text-xs">
              Screenshot of the in-app Add Contact screen, shown with the consent box
              unticked. Saving a contact requires ticking it. (Example data shown.)
            </figcaption>
          </figure>
          <p className="mt-3">
            The contact then receives a <strong>one-time designation notice</strong>{" "}
            before any alert can reach them:
          </p>
          <blockquote className="mt-3 rounded-md border-l-4 border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-4 text-sm">
            {DESIGNATION_NOTICE}
          </blockquote>
        </section>

        <section>
          <h2>What the conversation looks like</h2>
          <p className="mt-3">
            The same opt-in, from the contact&apos;s side of the phone. Replying YES is
            optional; when a contact does reply, they receive a short confirmation.
          </p>
          {/* Static illustration ONLY — never anything resembling a live form
              (30925 lesson). The designation notice is the filed sample 1;
              the YES confirmation is sent by AvServ's inbound webhook (plan
              22 §2 rider), not Twilio's auto-responder. */}
          <figure className="mt-4 flex flex-col items-center">
            <div className="w-full max-w-[340px] rounded-[2rem] border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
              <div className="border-b border-neutral-200 pb-2 text-center text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                AvAI &middot; {SMS_SENDER_NUMBER}
              </div>
              <div className="mt-3 flex flex-col gap-3 text-sm leading-6">
                <div className="mr-8 rounded-2xl rounded-tl-sm bg-neutral-100 p-3 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
                  {DESIGNATION_NOTICE}
                </div>
                <div className="self-end rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white">
                  YES
                </div>
                <div className="mr-8 rounded-2xl rounded-tl-sm bg-neutral-100 p-3 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
                  {YES_CONFIRMATION}
                </div>
              </div>
            </div>
            <figcaption className="text-muted-foreground mt-2 text-xs">
              Example: the text conversation an emergency contact receives. (Example
              data shown.)
            </figcaption>
          </figure>
          <p className="mt-3 text-sm">
            Every message in the program is governed by the{" "}
            <Link href="/terms" className="font-medium underline">
              terms of service
            </Link>{" "}
            and the{" "}
            <Link href="/privacy" className="font-medium underline">
              privacy policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2>YES, STOP, and HELP</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong>YES</strong> — an optional acknowledgment. Alerts flow by default
              once a contact is designated; no confirmation is required, because a safety
              alert that waits on a reply is not a safety alert. A contact who does
              reply YES receives the confirmation message shown in the conversation
              above.
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
                {HELP_REPLY}
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
