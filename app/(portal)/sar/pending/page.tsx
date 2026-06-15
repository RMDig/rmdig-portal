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
        .select({ id: sarOrgs.id, name: sarOrgs.name, status: sarOrgs.status })
        .from(sarOrgs)
        .where(eq(sarOrgs.createdByUserId, userId))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application received</h1>
        <p className="text-muted-foreground mt-1">
          Thanks for applying. Because SAR organizations receive safety-of-life alerts, every
          application is reviewed by our team before it&apos;s approved. We&apos;ll email you when
          there&apos;s a decision.
        </p>
      </div>

      {orgs.length > 0 ? (
        <ul className="divide-y rounded-md border">
          {orgs.map((org) => (
            <li key={org.id} className="flex items-center justify-between px-4 py-3">
              <span className="font-medium">{org.name}</span>
              <span className="text-muted-foreground text-sm">
                {STATUS_LABEL[org.status] ?? org.status}
              </span>
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
