import type { Metadata } from "next";
import Link from "next/link";

import { checkDeletionLink } from "@/lib/deletion/requests";

import { ConfirmDeletionForm } from "./ConfirmDeletionForm";

export const metadata: Metadata = {
  title: "Confirm deletion request — rmdig / AvAI",
};

export const dynamic = "force-dynamic";

// Landing page for the emailed confirmation link. Opening it changes nothing:
// mail scanners open links on delivery, and a confirmed request is acted on.
// The person confirms by typing the address the request was made for and
// pressing the button (confirmDeletionAction), which proves control of the
// address (the CPA request-authentication step) and is deliberate.
export default async function ConfirmDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) return <Invalid />;

  const state = await checkDeletionLink(token);
  if (state.kind === "invalid") return <Invalid />;
  if (state.kind === "expired") return <Expired />;
  if (state.kind === "confirmed") return <Confirmed requestId={state.id} />;

  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Confirm your deletion request</h1>
      <div className="mt-6 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          Confirming asks us to delete the personal data tied to your email address, in the
          rmdig portal and the AvAI app. Once it&apos;s carried out it can&apos;t be undone.
        </p>
        <p>To confirm, type the email address you made the request for.</p>
      </div>
      <ConfirmDeletionForm token={token} />
    </article>
  );
}

function Confirmed({ requestId }: { requestId: string }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Deletion request confirmed</h1>
      <div className="mt-6 space-y-4 leading-7 text-neutral-700 dark:text-neutral-200">
        <p>
          Your data-deletion request is confirmed and in our fulfillment queue. We&apos;ll
          complete it and reply to your email within 45 days, as the Colorado Privacy Act
          requires. You&apos;ll also find a confirmation in your inbox.
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Request reference: {requestId}</p>
      </div>
    </article>
  );
}

function Expired() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">This link has expired</h1>
      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">
        Confirmation links are valid for 24 hours.{" "}
        <Link href="/account/delete" className="font-medium underline">
          Submit a new deletion request
        </Link>{" "}
        and we&apos;ll send a fresh one.
      </p>
    </article>
  );
}

function Invalid() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Invalid confirmation link</h1>
      <p className="mt-6 leading-7 text-neutral-700 dark:text-neutral-200">
        This link isn&apos;t valid — it may have been truncated by your email client.{" "}
        <Link href="/account/delete" className="font-medium underline">
          Submit a new deletion request
        </Link>{" "}
        to get a fresh one.
      </p>
    </article>
  );
}
