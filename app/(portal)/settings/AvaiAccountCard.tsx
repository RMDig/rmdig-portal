import Link from "next/link";

import { AvaiIdentityForm } from "./AvaiIdentityForm";
import { classifyAgreementError, reportAgreementFailure } from "@/lib/agreement/errors";
import { normalizeName, passesAlertNameRule } from "@/lib/agreement/names";
import { type AvaiAccount, getAccount } from "@/lib/avserv/agreement";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// The user's AvAI account as AvServ holds it (contract account_agreement.md rev
// 2 §3.1, read over §4's GET): setup state, the names, and acceptances. AvServ
// is the system of record, so nothing here is cached in the portal DB.

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export async function AvaiAccountCard({
  userId,
  avservAccountId,
  portalName,
}: {
  userId: string;
  avservAccountId: string | null;
  portalName: string;
}) {
  if (!avservAccountId) {
    return (
      <Shell description="Your account isn't linked to AvAI yet. Sign out and back in, then return here." />
    );
  }

  // Keep the try/catch to data-fetching only; JSX is built after.
  let account: AvaiAccount | null = null;
  let unavailableMessage: string | null = null;
  try {
    account = await getAccount(avservAccountId);
  } catch (err) {
    const failure = classifyAgreementError(err);
    reportAgreementFailure("avai.account.read_failed", failure, err, { userId });
    unavailableMessage =
      failure.kind === "fault" ? "We couldn't load your AvAI account. Refresh in a moment." : failure.message;
  }

  if (!account) {
    return <Shell description={unavailableMessage ?? "We couldn't load your AvAI account."} />;
  }

  // Plan 31 D1: prefill the alert name from the portal name only when AvServ
  // would accept it; otherwise leave it for the user to choose.
  const alertNamePrefill =
    account.displayName ?? (passesAlertNameRule(portalName) ? normalizeName(portalName) : "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>AvAI account</CardTitle>
        <CardDescription>
          {account.activated
            ? `Set up${account.activatedAt ? ` on ${formatDate(account.activatedAt)}` : ""}.`
            : "Not set up yet. Add your names and accept the AvAI user agreement before your first check-out."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">Email</dt>
          <dd>
            {account.email ?? "—"}
            {account.email && account.emailVerified ? (
              <span className="text-muted-foreground"> (your sign-in email)</span>
            ) : null}
          </dd>
          <dt className="text-muted-foreground">Agreement</dt>
          <dd>
            {account.acceptances.length === 0
              ? "Not accepted"
              : account.acceptances
                  .map((a) => `${a.version} accepted ${formatDate(a.acceptedAt)}`)
                  .join("; ")}
          </dd>
        </dl>

        {account.agreement.needsAcceptance ? (
          <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950">
            <p>
              {account.activated
                ? "Please review and accept the current AvAI user agreement."
                : "Accept the AvAI user agreement to finish setting up."}
            </p>
            <Button asChild size="sm">
              <Link href="/settings/agreement">Review the agreement</Link>
            </Button>
          </div>
        ) : null}

        <AvaiIdentityForm legalName={account.legalName ?? ""} displayName={alertNamePrefill} />
      </CardContent>
    </Card>
  );
}

function Shell({ description }: { description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AvAI account</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
