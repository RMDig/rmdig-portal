import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { DecisionForm } from "./DecisionForm";
import { auth } from "@/lib/auth";
import { isPlatformStaff } from "@/lib/auth/roles";
import { listRestrictions, type Restriction } from "@/lib/avserv/restrictions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { restrictionReviewLog, restrictionReviewRequests, users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { scopeLabel } from "@/lib/restrictions/review";

export const metadata = {
  title: "Restriction review — rmdig",
};

// One review request, for staff: the user's message, the account's whole
// restriction history as AvServ holds it (staff-only notes included), the
// portal's audit log, and the decision form while the request is open.
export default async function RestrictionReviewDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/sign-in");
  }
  const staffId = session.user.id;
  if (!(await isPlatformStaff(staffId))) {
    redirect("/dashboard");
  }

  const { requestId } = await params;
  if (!z.string().uuid().safeParse(requestId).success) notFound();

  const [request] = await db
    .select({
      id: restrictionReviewRequests.id,
      status: restrictionReviewRequests.status,
      accountId: restrictionReviewRequests.avservAccountId,
      restrictionId: restrictionReviewRequests.restrictionId,
      message: restrictionReviewRequests.message,
      createdAt: restrictionReviewRequests.createdAt,
      email: users.email,
    })
    .from(restrictionReviewRequests)
    .innerJoin(users, eq(users.id, restrictionReviewRequests.userId))
    .where(eq(restrictionReviewRequests.id, requestId))
    .limit(1);
  if (!request) notFound();

  const log = await db
    .select({
      action: restrictionReviewLog.action,
      note: restrictionReviewLog.note,
      createdAt: restrictionReviewLog.createdAt,
      actor: users.email,
    })
    .from(restrictionReviewLog)
    .leftJoin(users, eq(users.id, restrictionReviewLog.actorUserId))
    .where(eq(restrictionReviewLog.requestId, request.id))
    .orderBy(desc(restrictionReviewLog.createdAt));

  let history: Restriction[] | null = null;
  try {
    history = await listRestrictions(request.accountId);
  } catch (err) {
    logger.error({ event: "restriction_review.detail_read_failed", staffId, requestId, err });
  }
  const current = history?.find((r) => r.id === request.restrictionId);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Review request</h1>
        <p className="text-muted-foreground text-sm">
          <Link href="/admin/restriction-reviews" className="hover:text-foreground underline">
            Restriction reviews
          </Link>{" "}
          / {request.email}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>From {request.email}</CardTitle>
          <CardDescription>
            Asked {request.createdAt.toLocaleString()} · status {request.status}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap">{request.message}</p>
        </CardContent>
      </Card>

      {request.status === "open" && history === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Can&apos;t decide right now</CardTitle>
            <CardDescription>
              AvAI couldn&apos;t be reached to load this account&apos;s restrictions. Refresh in a
              moment.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        // Mounted whether or not the request is still open: deciding revalidates
        // this page, and the form must survive that to show its outcome (an
        // uphold whose email failed must reach the staff member, §3.2).
        <DecisionForm
          requestId={request.id}
          open={request.status === "open"}
          inForce={!!current && current.state !== "lifted"}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Restriction history (AvAI)</CardTitle>
          <CardDescription>
            Everything this account has had, newest first. Operator and lift notes are staff-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history === null ? (
            <p className="text-sm text-red-700 dark:text-red-400">Couldn&apos;t load from AvAI.</p>
          ) : history.length === 0 ? (
            <p className="text-muted-foreground text-sm">None on this account.</p>
          ) : (
            <ul className="space-y-4">
              {history.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-md border p-3 text-sm ${r.id === request.restrictionId ? "border-amber-400 dark:border-amber-700" : ""}`}
                >
                  <p className="font-medium">
                    {scopeLabel(r.scope)} · {r.state} · {r.reasonCode}
                    {r.id === request.restrictionId ? " · this request" : ""}
                  </p>
                  <p>User sees: {r.userReason}</p>
                  {r.operatorNote ? <p>Operator note: {r.operatorNote}</p> : null}
                  <p className="text-muted-foreground">
                    Issued {r.issuedAt} by {r.issuedBy}
                    {r.activatedAt ? ` · active ${r.activatedAt}` : ""}
                    {r.liftedAt ? ` · lifted ${r.liftedAt} by ${r.liftedBy ?? "?"}` : ""}
                  </p>
                  {r.liftNote ? <p>Lift note: {r.liftNote}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {log.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.action}</span> · {e.createdAt.toLocaleString()} ·{" "}
                {e.actor ?? "(deleted user)"}
                {e.note ? <span className="block whitespace-pre-wrap">{e.note}</span> : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
