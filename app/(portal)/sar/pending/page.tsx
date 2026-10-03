import { eq } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";

export const metadata = {
  title: "Application under review — rmdig",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Under review",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
};

export default async function SarPendingPage() {
  // Layout enforces auth; this is a typed re-read for the ownership query.
  const session = await auth();
  const userId = session?.user?.id;

  const orgs = userId
    ? await db
        .select({ id: sarOrgs.id, name: sarOrgs.name, status: sarOrgs.status, reviewNote: sarOrgs.reviewNote })
        .from(sarOrgs)
        .where(eq(sarOrgs.createdByUserId, userId))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application received</h1>
        <p className="text-muted-foreground mt-1">
          Thanks for applying. Our staff review every application, and call to confirm where needed,
          before approving it. We&apos;ll email you when there&apos;s a decision.
        </p>
      </div>

      {orgs.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {orgs.map((org) => (
            <li key={org.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{org.name}</span>
                <span className="text-muted-foreground text-sm">
                  {STATUS_LABEL[org.status] ?? org.status}
                </span>
              </div>
              {org.status === "pending" && org.reviewNote ? (
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  <strong>Requested changes:</strong> {org.reviewNote}
                </p>
              ) : null}
              {org.status === "pending" ? (
                <Link href={`/sar/${org.id}/edit`} className="text-sm font-medium underline">
                  {org.reviewNote ? "Edit and resubmit" : "Edit your application"}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
