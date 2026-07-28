import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  BETA_DISCLOSURE,
  OPERATOR_CONTINUITY_DISCLOSURE,
} from "@/lib/legal/compliance-copy";

export const metadata: Metadata = {
  title: "What is AvAI? — the backcountry safety companion, in depth | RMDig",
  description:
    "AvAI (Avalanche AI) in depth: how the check-out/check-in safety watchdog works, Send Help, field snowpack capture, the beta status, and the research behind the name.",
  alternates: { canonical: "/avai" },
};

// The in-depth AvAI page, at the legacy URL the old marketing site had
// indexed (this REPLACES the /avai → / redirect in next.config — the path is
// a real page again). Linked from the centered header mark. Claim-ladder
// discipline applies throughout (doc 16 §6.2 scan; doc 13: describe what the
// beta does today, research framed as research).
export default function AvaiPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex flex-col items-center text-center">
        <Image
          src="/avai-logo.png"
          alt="AvAI"
          width={150}
          height={96}
          priority
          className="dark:hidden"
        />
        <Image
          src="/avai-logo-white.png"
          alt="AvAI"
          width={150}
          height={96}
          priority
          className="hidden dark:block"
        />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">What is AvAI?</h1>
      </div>

      <div className="mt-8 space-y-10 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <section className="space-y-4">
          <p>
            AvAI is a <strong>safety companion app for backcountry travel</strong>, built
            by Rocky Mountain Digerati in Colorado. The core idea is old-school and
            proven — tell someone where you&apos;re going and when you&apos;ll be back —
            made automatic: you check out before heading into the field, and if you
            don&apos;t check back in on time, our servers alert the emergency contact you
            chose, with your last-known location.
          </p>
          <p className="font-medium text-neutral-900 dark:text-neutral-50">
            {BETA_DISCLOSURE}
          </p>
        </section>

        <section>
          <h2>Check out / check in — how it actually works</h2>
          <p className="mt-3">
            When you check out, you set a return time and AvAI&apos;s servers start
            watching the clock — not your phone. That distinction is the design&apos;s
            core property: once a check-out is armed, the watchdog runs server-side, so a
            dead battery, no signal, or a lost phone can&apos;t silence it. If your
            check-in time passes without word, your emergency contact gets an alert by
            text and email with your last-known location and, where we can identify one,
            the local search &amp; rescue organization for the area. Checking out and in
            requires cell or internet signal; the alerts themselves are sent by our
            servers regardless of your connectivity. Delivery favors sending an alert
            twice over not at all, so occasional duplicates are by design.
          </p>
        </section>

        <section>
          <h2>Send Help</h2>
          <p className="mt-3">
            Beyond the scheduled check-in, AvAI has an active path: a Send Help button
            that immediately alerts your emergency contact with your location when you
            need assistance now. A retraction window and an &quot;I&apos;m OK&quot;
            follow-up keep accidental triggers honest. AvAI alerts the people you chose —
            it does not contact 911 or rescue services on your behalf.
          </p>
        </section>

        <section>
          <h2>Field observations</h2>
          <p className="mt-3">
            AvAI includes a field capture tool for snowpack observations — profile and
            core photos framed on a crystal card, the same{" "}
            <Link href="/methods" className="font-medium underline">
              method
            </Link>{" "}
            behind our open{" "}
            <Link href="/snowpack_dataset" className="font-medium underline">
              Rocky Mountain Snowpack dataset
            </Link>
            . At this stage of the beta, photos stay on your device; a future opt-in flow
            will let users contribute captures to the public dataset with explicit
            consent.
          </p>
        </section>

        <section>
          <h2>Why &quot;AvAI&quot;?</h2>
          <p className="mt-3">
            The name is short for <strong>Avalanche AI</strong>. Alongside the app, we
            research avalanche-risk modeling on snowpack imagery — the{" "}
            <Link href="/models" className="font-medium underline">
              open-source snowGAN models
            </Link>{" "}
            are the first public artifacts of that line. The research is in development
            and is not part of the app today; when it first ships it will be clearly
            labeled as a research preview.
          </p>
        </section>

        <section>
          <h2>Who runs it — honestly</h2>
          <p className="mt-3">{OPERATOR_CONTINUITY_DISCLOSURE}</p>
        </section>

        <section>
          <h2>Where it stands</h2>
          <p className="mt-3">
            AvAI is currently in TestFlight / Play Internal beta. If you&apos;re a
            backcountry traveler who wants in, a Search &amp; Rescue team interested in
            the platform, or an emergency contact trying to understand{" "}
            <Link href="/alerts" className="font-medium underline">
              a message you received
            </Link>
            , start at{" "}
            <Link href="/support" className="font-medium underline">
              support
            </Link>{" "}
            — or{" "}
            <Link href="/sign-up" className="font-medium underline">
              create a portal account
            </Link>
            . How our safety texts work, including the exact messages we send, is
            documented at{" "}
            <Link href="/sms" className="font-medium underline">
              rmdig.ai/sms
            </Link>
            .
          </p>
        </section>
      </div>
    </article>
  );
}
