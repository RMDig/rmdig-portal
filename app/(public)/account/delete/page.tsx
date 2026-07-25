import type { Metadata } from "next";
import Link from "next/link";

import { DeletionRequestForm } from "./DeletionRequestForm";

export const metadata: Metadata = {
  title: "Delete my data — rmdig / AvAI",
  description:
    "Request deletion of your personal data from AvAI and the rmdig portal (Colorado Privacy Act).",
};

// The store-listing "how do I delete my data" URL and the Privacy Policy's
// CPA deletion path both point here. Public, no auth: app users and emergency
// contacts may have no portal account. Identity is proven by the email
// confirmation round-trip, not by a session.
export default function DeleteDataPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Delete my data</h1>

      <div className="mt-6 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          Use this form to request deletion of the personal data associated with your email
          address — your portal account (if you have one), check-out/check-in history,
          device heartbeat telemetry, capture metadata, and emergency-contact details held
          on our servers. This works whether or not you ever created a portal account.
        </p>
        <p>
          We&apos;ll email you a confirmation link first, to make sure the request really
          comes from you. Once you confirm, we&apos;ll complete the deletion and reply to
          you within 45 days, as the Colorado Privacy Act requires.
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Photos you captured with AvAI live on your device, not on our servers — delete
          the app or its data to remove them. See the{" "}
          <Link href="/privacy" className="font-medium underline">
            Privacy Policy
          </Link>{" "}
          for the full picture of what we hold.
        </p>
      </div>

      <div className="mt-8 max-w-md">
        <DeletionRequestForm />
      </div>
    </article>
  );
}
