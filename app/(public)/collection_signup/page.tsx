import type { Metadata } from "next";
import Link from "next/link";

import { CollectionSignupForm } from "./CollectionSignupForm";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Volunteer: snowpack data collection — RMDig",
  description:
    "Sign up to help Rocky Mountain Digerati collect snowpack data in the Colorado backcountry for the open Rocky Mountain Snowpack dataset.",
  path: "/collection_signup",
});

// Press-linked URL from the pre-cutover site: news coverage of the dataset
// sends volunteers to rmdig.ai/collection_signup, so this path is frozen
// (never rename, move, or put it behind sign-in; CLAUDE.md §3.7). It went
// missing in the 2026-07 cutover and 404'd until 2026-10-15.
export default function CollectionSignupPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Dig snowpits with us</h1>

      <div className="mt-6 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          Rocky Mountain Digerati is looking for volunteers to collect snowpack data in the
          backcountry. The samples go into the open{" "}
          <Link href="/snowpack_dataset" className="font-medium underline">
            Rocky Mountain Snowpack dataset
          </Link>
          , which we use to research AI models of avalanche risk and which anyone can use
          for their own snow-science work.
        </p>
        <p>
          You need basic backcountry skiing or splitboarding experience and your own
          avalanche gear. We supply the data-collection equipment and show you the{" "}
          <Link href="/research/methods" className="font-medium underline">
            field method
          </Link>
          . Fill in the form and we&apos;ll email you if there&apos;s a spot on the team this
          season.
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          We use what you send only to organize data collection, and don&apos;t add you to any
          mailing list. See the{" "}
          <Link href="/privacy" className="font-medium underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>

      <div className="relative mt-8 max-w-xl">
        <CollectionSignupForm />
      </div>
    </article>
  );
}
