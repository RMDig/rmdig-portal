import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { isPlatformStaff } from "@/lib/auth/roles";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { restrictionReviewRequests, restrictionReviewStatus, users } from "@/lib/db/schema";
import { formatMountain } from "@/lib/format/time";
import { RESTRICTION_REVIEW_STATUS_LABEL } from "@/lib/labels";

export const metadata = {
  title: "Restriction reviews — rmdig",
};

type Status = (typeof restrictionReviewStatus.enumValues)[number];
const FILTERS: Array<Status | "all"> = ["open", "upheld", "lifted", "closed", "all"];

// The staff queue of review requests (docs/plans/32). Open requests list
// oldest first, so nobody waits longest; decided ones newest first.
export default async function RestrictionReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return redirectToSignIn();
  }
  if (!(await isPlatformStaff(session.user.id))) {
    redirect("/dashboard");
  }

  const { status: raw } = await searchParams;
  const filter = FILTERS.find((f) => f === raw) ?? "open";

  const base = db
    .select({
      id: restrictionReviewRequests.id,
      status: restrictionReviewRequests.status,
      createdAt: restrictionReviewRequests.createdAt,
      decidedAt: restrictionReviewRequests.decidedAt,
      email: users.email,
    })
    .from(restrictionReviewRequests)
    .innerJoin(users, eq(users.id, restrictionReviewRequests.userId));
  const rows =
    filter === "all"
      ? await base.orderBy(desc(restrictionReviewRequests.createdAt))
      : await base
          .where(eq(restrictionReviewRequests.status, filter))
          .orderBy(
            filter === "open"
              ? asc(restrictionReviewRequests.createdAt)
              : desc(restrictionReviewRequests.createdAt),
          );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Restriction reviews</h1>
        <p className="text-muted-foreground text-sm">
          Users asking us to review a restriction on their AvAI account. Lifting goes to AvAI,
          which emails the user; upholding emails them from here.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/restriction-reviews?status=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-md border px-3 py-1 ${f === filter ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : ""}`}
          >
            {f}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here</CardTitle>
            <CardDescription>No {filter === "all" ? "" : `${filter} `}review requests.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/restriction-reviews/${r.id}`}
                className="flex flex-col gap-1 p-4 hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-neutral-900"
              >
                <span className="font-medium">{r.email}</span>
                <span className="text-muted-foreground text-sm">
                  {RESTRICTION_REVIEW_STATUS_LABEL[r.status]} · asked {formatMountain(r.createdAt)}
                  {r.decidedAt ? ` · decided ${formatMountain(r.decidedAt)}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
