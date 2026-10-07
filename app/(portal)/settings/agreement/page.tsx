import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import Link from "next/link";
import Markdown from "react-markdown";

import { AgreementForm } from "./AgreementForm";
import { presentedAgreement } from "@/lib/agreement";
import { classifyAgreementError, reportAgreementFailure } from "@/lib/agreement/errors";
import { normalizeName, passesAlertNameRule } from "@/lib/agreement/names";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { type AvaiAccount, getAccount } from "@/lib/avserv/agreement";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const metadata = {
  title: "AvAI user agreement — rmdig",
};

// Each render mints a fresh idempotency key and display time, so this page must
// never be served from a cache.
export const dynamic = "force-dynamic";

// The AvAI user agreement, rendered exactly as pinned from AvServ (docs/plans/31
// §4; contract account_agreement.md rev 2 §2): the markdown text, the assent
// line and each attestation label. The hashes sent on accept are computed from
// these same strings.
export default async function AgreementPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }
  const userId = session.user.id;

  const presented = presentedAgreement();
  if (!presented) {
    return (
      <Page>
        <Notice
          title="Not published yet"
          description="The AvAI user agreement hasn't been published yet. There's nothing to accept for now."
        />
      </Page>
    );
  }

  const [user] = await db
    .select({
      avservAccountId: users.avservAccountId,
      displayName: users.displayName,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.avservAccountId) {
    return (
      <Page>
        <Notice
          title="AvAI account not linked"
          description="Your account isn't linked to AvAI yet. Sign out and back in, then return here."
        />
      </Page>
    );
  }

  let account: AvaiAccount | null = null;
  let loadError: string | null = null;
  try {
    account = await getAccount(user.avservAccountId);
  } catch (err) {
    const failure = classifyAgreementError(err);
    reportAgreementFailure("agreement.page.read_failed", failure, err, { userId });
    loadError =
      failure.kind === "fault" ? "We couldn't load your AvAI account. Refresh in a moment." : failure.message;
  }
  if (!account) {
    return (
      <Page>
        <Notice title="AvAI user agreement" description={loadError ?? "Something went wrong."} />
      </Page>
    );
  }

  // Accepted already: this version is on record and nothing newer is asking
  // (a newer current version than the pin can't be offered until a release).
  const acceptance = account.acceptances.findLast((a) => a.version === presented.version);
  const settled =
    acceptance !== undefined &&
    (!account.agreement.needsAcceptance || account.agreement.currentVersion !== presented.version);

  const portalName = user.displayName ?? user.name ?? "";
  const alertNamePrefill =
    account.displayName ?? (passesAlertNameRule(portalName) ? normalizeName(portalName) : "");

  const text = (
    <div className="space-y-4 leading-7 [&_a]:underline [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-6 [&_ol]:list-decimal [&_ul]:list-disc">
      {/* Raw HTML in the source is skipped, never rendered (plan 31 D5). */}
      <Markdown skipHtml>{presented.text}</Markdown>
    </div>
  );

  return (
    <Page>
      {presented.fixture ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          Test fixture for automated tests. This is not the AvAI user agreement.
        </p>
      ) : null}
      {settled && acceptance ? (
        <p className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          You accepted this agreement ({presented.version}) on{" "}
          {new Date(acceptance.acceptedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          .
        </p>
      ) : null}
      <AgreementForm
        version={presented.version}
        assentText={presented.assent.text}
        attestations={presented.attestations.map(({ id, text: label, required }) => ({
          id,
          label,
          required,
        }))}
        idempotencyKey={randomUUID()}
        displayedAt={new Date().toISOString()}
        legalName={account.legalName ?? ""}
        displayName={alertNamePrefill}
        showForm={!settled}
      >
        {text}
      </AgreementForm>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">AvAI user agreement</h1>
        <p className="text-muted-foreground text-sm">
          <Link href="/settings" className="hover:text-foreground underline">
            Settings
          </Link>{" "}
          / Agreement
        </p>
      </div>
      {children}
    </div>
  );
}

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
