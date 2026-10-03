import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { canManageOrg } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarOrgs } from "@/lib/db/schema";
import { getRegionAsGeoJson } from "@/lib/sar/geo";

import { EditOrgForm } from "./EditOrgForm";

export const metadata = { title: "Edit your application — rmdig" };

// Org admins edit a pending application here, after "changes requested" or
// before review. The action re-checks every rule.
export default async function EditOrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/sign-in");
  if (!/^[0-9a-f-]{36}$/i.test(orgId) || !(await canManageOrg(userId, orgId))) redirect("/dashboard");

  const [org] = await db.select().from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) redirect("/dashboard");

  if (org.status !== "pending") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <p className="text-muted-foreground">
          Only an application under review can be edited. To change an approved organization, contact
          support.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    );
  }

  const region = await getRegionAsGeoJson(orgId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit your application</h1>
        <p className="text-muted-foreground mt-1">{org.name}</p>
      </div>
      {org.reviewNote ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <strong>Requested changes:</strong> {org.reviewNote}
        </div>
      ) : null}
      <EditOrgForm
        orgId={orgId}
        region={region}
        contactPhone={org.contactPhone}
        initial={{
          orgType: org.orgType,
          name: org.name,
          description: org.description ?? "",
          operatingStatus: org.operatingStatus,
          operatingStatusOther: org.operatingStatusOther ?? "",
          contactName: org.contactName,
          contactEmail: org.contactEmail,
          regionName: org.regionName ?? "",
        }}
      />
    </div>
  );
}
