"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

// Error boundary for every page below the root layout, including the portal
// layout, which reads the database on each signed-in page. Without it a
// database outage showed the bare global-error screen. Says only what we know:
// this page failed on our side, and makes no claim about AvAI (CLAUDE.md §0).
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">This page couldn&apos;t load</h1>
      <p className="mt-3 leading-7 text-neutral-600 dark:text-neutral-300">
        Something failed on our side. It has been reported. Please try again in a few minutes.
      </p>
      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Try again
        </button>
        <Link href="/support" className="text-sm font-medium underline">
          Support
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-6 text-xs text-neutral-400">Reference: {error.digest}</p>
      ) : null}
    </main>
  );
}
