import { asc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMountain } from "@/lib/announcements/announcements";
import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { hasPlatformRole } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { deletionRequests, users } from "@/lib/db/schema";
import { cpaDaysLeft } from "@/lib/deletion/share-log";

import { MarkCompletedForm } from "./MarkCompletedForm";
import { ShareLogLookupForm } from "./ShareLogLookup";

export const metadata = { title: "Deletion requests — rmdig admin" };

// The confirmed deletion queue (runbook "Data-deletion requests"), with each
// request's Colorado Privacy Act deadline and, per request, which SAR teams
// AvAI sent the account's data to. Fulfilment itself stays the runbook's
// operator steps.
export default async function DeletionRequestsPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  if (!(await hasPlatformRole(session.user.id, "rmdig_admin"))) redirect("/admin");

  const queue = await db
    .select({ id: deletionRequests.id, email: deletionRequests.email, confirmedAt: deletionRequests.confirmedAt })
    .from(deletionRequests)
    .where(eq(deletionRequests.status, "confirmed"))
    .orderBy(asc(deletionRequests.confirmedAt));
  const emails = queue.map((q) => q.email.toLowerCase());
  const linked = emails.length
    ? await db
        .select({ email: sql<string>`lower(${users.email})`, accountId: users.avservAccountId })
        .from(users)
        .where(inArray(sql`lower(${users.email})`, emails))
    : [];
  const accountFor = new Map(linked.map((l) => [l.email, l.accountId]));
  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Deletion requests</h1>
        <p className="text-muted-foreground mt-1">
          Confirmed requests, oldest first. Each must be completed and answered within 45 days of confirmation. Work
          each one with the runbook&apos;s steps; the lookup shows which search &amp; rescue teams received the
          account&apos;s data, so they can be told.
        </p>
      </div>
      {queue.length === 0 ? <p className="text-muted-foreground text-sm">No confirmed requests are waiting.</p> : null}
      {queue.map((q) => {
        const left = q.confirmedAt ? cpaDaysLeft(q.confirmedAt, now) : null;
        return (
          <Card key={q.id}>
            <CardHeader>
              <CardTitle className="text-base">{q.email}</CardTitle>
              <CardDescription>
                Confirmed {q.confirmedAt ? formatMountain(q.confirmedAt) : "(no date)"} ·{" "}
                <span className={left !== null && left <= 7 ? "font-medium text-red-600" : undefined}>
                  {left === null ? "deadline unknown" : left >= 0 ? `${left} days left` : `${-left} days overdue`}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShareLogLookupForm requestId={q.id} suggestedAccountId={accountFor.get(q.email.toLowerCase()) ?? null} />
              {!accountFor.get(q.email.toLowerCase()) ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  No portal account is linked to this email. Find its AvAI accounts above, or use the account id from the AvServ deletion step.
                </p>
              ) : null}
              <div className="mt-4">
                <MarkCompletedForm requestId={q.id} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
