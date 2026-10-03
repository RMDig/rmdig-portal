import type { Metadata } from "next";
import Link from "next/link";

import { ResearchTabs } from "@/components/public/ResearchTabs";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Research — open snowpack data, models and avalanche-risk research | RMDig",
  description:
    "Rocky Mountain Digerati's open research behind AvAI (Avalanche AI): the Rocky Mountain Snowpack dataset, open-source snowpack models, our field methods, and early research on detecting backcountry accidents.",
  path: "/research",
});

// Public research surface (doc 16 §6.2 scan applies). Research is described as
// research, never as an app capability.
const SECTIONS = [
  {
    href: "/snowpack_dataset",
    title: "The Rocky Mountain Snowpack dataset",
    body: "Open snowpack imagery from the Colorado backcountry, core photos and magnified profiles, under CC BY 4.0.",
  },
  {
    href: "/research/models",
    title: "Open-source models",
    body: "Generative snowpack models trained on the dataset, published on Hugging Face for anyone to explore and build on.",
  },
  {
    href: "/research/methods",
    title: "Field methods",
    body: "How samples are collected: snowpits, a mini-coring method, crystal cards and magnified profile photography.",
  },
  {
    href: "/research/incident-detection",
    title: "Incident Detection",
    body: "Early research on whether a phone's motion sensors can recognize signs of a backcountry accident.",
  },
] as const;

export default function ResearchPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <ResearchTabs />
      <h1 className="text-3xl font-semibold tracking-tight">Research</h1>
      <div className="mt-6 space-y-8 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          AvAI is short for <strong>Avalanche AI</strong>. Alongside the app, we collect open
          snowpack data, publish open-source models, and research how phones and machine
          learning could help backcountry travelers. The research is in development and is not
          part of the app today.
        </p>

        <ul className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="block h-full rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
              >
                <h2 className="font-semibold text-neutral-900 dark:text-neutral-50">{s.title}</h2>
                <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{s.body}</p>
              </Link>
            </li>
          ))}
        </ul>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            How we release models
          </h2>
          <p>
            We release our models that aren&apos;t meant for safety decisions as open source.
            Safety models we train will be released only after independent experts have
            peer-reviewed them.
          </p>
        </section>
      </div>
    </article>
  );
}
