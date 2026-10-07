import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { ReviewRequestForm } from "./ReviewRequestForm";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { listRestrictions, type Restriction } from "@/lib/avserv/restrictions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { restrictionReviewRequests, users } from "@/lib/db/schema";
import { SUPPORT_EMAIL } from "@/lib/legal/compliance-copy";
import { logger } from "@/lib/logger";
import { reviewableRestrictions, scopeLabel } from "@/lib/restrictions/review";

export const metadata = {
  title: "Account review — rmdig",
};

// Each render mints a fresh submission key per form, so never cache.
export const dynamic = "force-dynamic";

// The review link AvServ puts in its notices and emails (contract
// restrictions.md §8): https://rmdig.ai/account/review?restriction=<id>. It
// shows ONLY the signed-in user's own restrictions, read through the
// account-scoped GET. The query id is matched against that list for emphasis
// and never looked up (§8); when it isn't there, the restriction is probably
// on a device account that isn't linked to this login yet (§7).

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AccountReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ restriction?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }
  const userId = session.user.id;
  const { restriction } = await searchParams;
  const askedFor = typeof restriction === "string" ? restriction : null;

  const [user] = await db
    .select({ avservAccountId: users.avservAccountId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.avservAccountId) {
    return (
      <Page>
        <Notice
          title="AvAI account not linked"
          description="Your rmdig account isn't linked to AvAI yet. Sign out and back in, then return to this page."
        />
        <LinkDeviceHelp />
      </Page>
    );
  }

  // Keep the try/catch to data-fetching only; JSX is built after.
  let all: Restriction[] | null = null;
  try {
    all = await listRestrictions(user.avservAccountId);
  } catch (err) {
    logger.error({ event: "restriction_review.page_read_failed", userId, err });
  }
  if (!all) {
    return (
      <Page>
        <Notice
          title="Couldn't load your account"
          description="We couldn't reach AvAI to load your account. Refresh in a moment."
        />
      </Page>
    );
  }

  const inForce = reviewableRestrictions(all);
  const requests = await db
    .select({
      restrictionId: restrictionReviewRequests.restrictionId,
      status: restrictionReviewRequests.status,
      createdAt: restrictionReviewRequests.createdAt,
      decidedAt: restrictionReviewRequests.decidedAt,
    })
    .from(restrictionReviewRequests)
    .where(eq(restrictionReviewRequests.userId, userId))
    .orderBy(desc(restrictionReviewRequests.createdAt));

  const askedForHere = askedFor ? all.find((r) => r.id === askedFor) : undefined;

  return (
    <Page>
      {askedFor && !askedForHere ? <LinkDeviceHelp /> : null}
      {askedForHere && askedForHere.state === "lifted" ? (
        <Notice
          title="No longer in effect"
          description={`${scopeLabel(askedForHere.scope)} was restored on your account${
            askedForHere.liftedAt ? ` on ${formatDate(askedForHere.liftedAt)}` : ""
          }. There's nothing to review.`}
        />
      ) : null}

      {inForce.length === 0 ? (
        askedFor ? null : (
          <Notice
            title="Nothing is restricted"
            description="Every feature is available on your AvAI account."
          />
        )
      ) : (
        inForce.map((r) => {
          const latest = requests.find((q) => q.restrictionId === r.id);
          const open = latest?.status === "open";
          return (
            <Card
              key={r.id}
              className={r.id === askedFor ? "border-amber-400 dark:border-amber-700" : undefined}
            >
              <CardHeader>
                <CardTitle>{scopeLabel(r.scope)} is paused</CardTitle>
                <CardDescription>
                  Since {formatDate(r.activatedAt ?? r.issuedAt)}. Check-out, check-in and Send Help
                  work exactly as before.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-muted-foreground text-sm">Why</p>
                  <p className="whitespace-pre-wrap">{r.userReason}</p>
                </div>
                {open ? (
                  <p className="rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
                    Your review request from {formatDate(latest.createdAt.toISOString())}{" "}
                    is with our team. We&apos;ll email you when it&apos;s decided.
                  </p>
                ) : (
                  <>
                    {latest?.status === "upheld" ? (
                      <p className="text-sm">
                        We reviewed your last request
                        {latest.decidedAt ? ` on ${formatDate(latest.decidedAt.toISOString())}` : ""}{" "}
                        and kept this in place. If something has changed, you can ask again.
                      </p>
                    ) : null}
                    <ReviewRequestForm restrictionId={r.id} submissionKey={randomUUID()} />
                  </>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account review</h1>
        <p className="text-muted-foreground text-sm">
          Restrictions on your AvAI account, and how to ask us to review one. Questions:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
            {SUPPORT_EMAIL}
          </a>
          .
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

// Contract §7: a device-first AvAI account has no rmdig login, so its
// restriction isn't on the account this login maps to until the device links.
function LinkDeviceHelp() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Not on this account</CardTitle>
        <CardDescription>
          The restriction in your link isn&apos;t on the AvAI account you&apos;re signed in to.
          This usually means the phone that received the notice isn&apos;t linked to this account
          yet. Link it under{" "}
          <Link href="/settings/devices" className="underline">
            Settings &gt; Devices
          </Link>
          , then open the link from the notice again.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
