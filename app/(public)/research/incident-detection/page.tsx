import type { Metadata } from "next";
import Link from "next/link";

import { ResearchTabs } from "@/components/public/ResearchTabs";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Incident Detection research — sensing backcountry accidents | RMDig",
  description:
    "Early-stage AvAI research into whether a phone's motion sensors can recognize signs of a backcountry accident, such as a hard impact or avalanche involvement. Field testing is planned; there are no results yet.",
  path: "/research/incident-detection",
});

// Public research surface (doc 16 §6.2 scan applies). Deliberately general:
// no data has been collected yet (operator, 2026-10-03), so this page states a
// direction and a status, never a capability or a result. The feature is not
// in the app; /privacy and /alerts describe it only "when available".
export default function IncidentDetectionPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <ResearchTabs />
      <h1 className="text-3xl font-semibold tracking-tight">Incident Detection research</h1>
      <div className="mt-6 space-y-6 leading-7 text-neutral-700 dark:text-neutral-200 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-neutral-900 dark:[&_h2]:text-neutral-50">
        <p>
          A missed check-in only raises the alarm once your return time has passed. We&apos;re
          researching whether a phone&apos;s motion sensors could recognize signs of an
          accident sooner: for example, a hard impact followed by stillness, or the tumbling of
          being caught in an avalanche.
        </p>

        <section className="space-y-3">
          <h2>Where it stands</h2>
          <p>
            This is early research. We have a data-collection plan and expect to start
            controlled field tests this winter. There are no results yet.
          </p>
        </section>

        <section className="space-y-3">
          <h2>In the app</h2>
          <p>
            Incident Detection isn&apos;t available in AvAI. If it becomes available, it will be
            optional, and we&apos;ll update the{" "}
            <Link href="/privacy" className="font-medium underline">
              privacy policy
            </Link>{" "}
            before it ships to say exactly what it sends.
          </p>
        </section>

        <section className="space-y-3">
          <h2>What we&apos;ll share</h2>
          <p>
            We&apos;ll publish our methods and findings as they mature. Any safety model that
            comes out of this work will be peer-reviewed by independent experts before we
            release it.
          </p>
        </section>
      </div>
    </article>
  );
}
