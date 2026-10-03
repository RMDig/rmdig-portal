import type { Metadata } from "next";
import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Did you get an AvAI alert about someone? | RMDig",
  description:
    "What an AvAI safety alert means, why you received a text or email about someone, what to do next, and how your information is handled.",
  path: "/alerts",
});

// Landing surface for emergency contacts who received an SMS/email and typed
// in the bare domain (AvServ's no-URL-in-SMS rule sends them to rmdig.ai, not
// a deep link — doc 32 review, 2026-07-26). The audience may be worried and
// unfamiliar with AvAI, so this page leads with what the alert MEANS and what
// to DO. Public-copy discipline (doc 16 §6.2 scan) applies.
export default function AlertsExplainerPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Did you get an alert about someone?
      </h1>

      <div className="mt-6 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            You received a text or email from AvAI because someone you know named you as
            their <strong>emergency contact</strong>. AvAI is a backcountry safety app:
            before heading into the field, a user schedules a check-in time — and if they
            don&apos;t check in, our servers alert the person they chose. That&apos;s you.
          </p>
        </section>

        <section>
          <h2>What each message means</h2>
          <ul className="mt-3 list-disc space-y-3 pl-6">
            <li>
              <strong>Overdue alert</strong> — the person did not check in by the time they
              set. The message includes their last-known location. They may simply be out
              of cell range or delayed, but treat it seriously.
            </li>
            <li>
              <strong>Send Help alert</strong> — the person actively pressed AvAI&apos;s
              Send Help button, requesting assistance at the location in the message.
            </li>
            <li>
              <strong>All-clear</strong> — the person has since checked in safe. No action
              needed.
            </li>
            <li>
              <strong>More than one alert</strong> — You may occasionally receive the same
              alert more than once. Treat every alert as real until you reach them. You may
              also get a follow-up saying our system may have sent you more than one; it is
              one situation, not several.
            </li>
          </ul>
        </section>

        <section>
          <h2>What to do</h2>
          <ol className="mt-3 list-decimal space-y-3 pl-6">
            <li>
              <strong>Try to reach them</strong> — call and text the person directly.
              An overdue alert often means a dead battery or no signal on the drive home.
            </li>
            <li>
              <strong>If you can&apos;t reach them and are concerned</strong>, contact your
              local emergency services (911 in the US) or the sheriff&apos;s office for the
              county where they were traveling, and share the last-known location from the
              message.
            </li>
            <li>
              <strong>Keep the message</strong> — the coordinates and timestamp in it are
              exactly what responders will ask for.
            </li>
          </ol>
        </section>

        <section>
          <h2>What AvAI does not do</h2>
          <ul className="mt-3 list-disc space-y-3 pl-6">
            <li>
              <strong>It never calls 911 or any emergency service itself.</strong> AvAI
              alerts you, the person they chose. Whether to call for help is your decision.
            </li>
            <li>
              <strong>It is not a beacon.</strong> Rescuers can&apos;t use AvAI to find the
              person&apos;s phone, and it doesn&apos;t signal anyone nearby. The location in
              the message is the last one their phone sent to us, which may be from some
              time before the alert.
            </li>
          </ul>
        </section>

        <section>
          <h2>About your information</h2>
          <p className="mt-3">
            We hold your name and contact details only because the AvAI user provided them,
            and use them only to deliver these safety messages — never for marketing. The
            full story is in our{" "}
            <Link href="/privacy" className="font-medium underline">
              privacy policy
            </Link>
            , including how to{" "}
            <Link href="/account/delete" className="font-medium underline">
              request deletion
            </Link>
            . Replying <strong>STOP</strong> to a text opts you out of all messages —
            including real safety alerts about that person — so if you opt out, tell them
            to choose a different emergency contact.
          </p>
        </section>

        <section>
          <h2>Questions</h2>
          <p className="mt-3">
            Anything unclear, or an alert you think you received in error:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">
              {SUPPORT_EMAIL}
            </a>
            . If someone may be in danger right now, contact local emergency services
            first — email is not an emergency channel.
          </p>
        </section>
      </div>
    </article>
  );
}
