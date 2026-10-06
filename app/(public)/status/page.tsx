import type { Metadata } from "next";
import Link from "next/link";

import { formatMountain } from "@/lib/announcements/announcements";
import { env } from "@/lib/env";
import { pageMetadata } from "@/lib/seo";
import { checkNodes, nodeBases, overall } from "@/lib/status/check";
import { STATUS_PAGE_URL } from "@/lib/status-page";

export const metadata: Metadata = pageMetadata({
  title: "Is AvAI down? AvAI service status",
  description:
    "Check whether AvAI's alert servers and the rmdig.ai website are up, and see outage history. If AvAI is down, use your second safety plan; in an emergency, call 911.",
  path: "/status",
});

// Public and auth-free (CLAUDE.md §3.7): checks only the alert servers'
// public readiness endpoints, cached for a minute. If this page loads, the
// website is up; the full history lives on the UptimeRobot page. Error and
// maintenance pages link straight to UptimeRobot, since this page goes down
// with the site.
export const revalidate = 60;

const HEADLINE = {
  up: "AvAI's alert servers are answering.",
  partial: "One of AvAI's alert servers isn't answering. The other is.",
  down: "AvAI's alert servers aren't answering.",
  unchecked: "Alert servers aren't checked on this deployment.",
} as const;

export default async function StatusPage() {
  const nodes = await checkNodes(nodeBases(env.AVSERV_BASE_URL, env.AVSERV_FAILOVER_BASE_URL));
  const state = overall(nodes);
  const checkedAt = formatMountain(new Date());
  const tone =
    state === "up"
      ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200"
      : state === "unchecked"
        ? "border-neutral-300 bg-neutral-50 text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        : "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200";

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">AvAI status</h1>

      <section className={`mt-8 rounded-lg border p-5 ${tone}`} aria-live="polite">
        <p className="text-lg font-medium">{HEADLINE[state]}</p>
        {state === "partial" || state === "down" ? (
          <p className="mt-2">
            While service is interrupted, armed check-outs may not be watched. Fall back to your second safety
            plan. In an emergency, call 911.
          </p>
        ) : null}
        <p className="mt-2 text-sm opacity-80">Checked {checkedAt}. This page refreshes about once a minute.</p>
      </section>

      <ul className="mt-6 divide-y rounded-md border border-neutral-200 dark:border-neutral-800">
        <li className="flex items-center justify-between px-4 py-3">
          <span>rmdig.ai website</span>
          <span className="font-medium text-green-700 dark:text-green-400">Up</span>
        </li>
        {nodes.map((n) => (
          <li key={n.name} className="flex items-center justify-between px-4 py-3">
            <span>{n.name}</span>
            <span className={`font-medium ${n.up ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {n.up ? "Answering" : "Not answering"}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-10 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          For outage history and the status of each service over time, see the{" "}
          <a href={STATUS_PAGE_URL} className="font-medium underline">
            full status page
          </a>
          . It&apos;s hosted separately, so it stays up if rmdig.ai doesn&apos;t.
        </p>
        <p>
          AvAI is in beta and run by a small team. Use it as one layer of your safety practice, never your only
          one. Questions about an outage? See{" "}
          <Link href="/support" className="font-medium underline">
            Support
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
