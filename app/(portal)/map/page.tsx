import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getPlatformRoles } from "@/lib/auth/roles";
import { layersFor } from "@/lib/map/layers";
import { advertiserIdsFor, allOrgRows, memberOrgRows, targetRows } from "@/lib/map/queries";

import { MapView } from "./MapView";

export const metadata = { title: "Map — rmdig" };

// One map for every role (docs/plans/33, Phase 1): each viewer sees only their
// own organizations' service areas and their own ad targets; staff also see
// every organization. View-only: editing an approved org's area would change
// where alerts route without review (CLAUDE.md §0), so changes stay on the
// existing forms. Scoped here on the server, re-checking the session rather
// than trusting the layout.
export default async function MapPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const userId = session.user.id;

  const [roles, memberOrgs, advertiserIds] = await Promise.all([
    getPlatformRoles(userId),
    memberOrgRows(userId),
    advertiserIdsFor(userId),
  ]);
  const isStaff = roles.length > 0;
  const [targets, allOrgs] = await Promise.all([
    targetRows(advertiserIds),
    isStaff ? allOrgRows() : Promise.resolve(null),
  ]);

  const layers = layersFor({
    isStaff,
    memberOrgs,
    isAdvertiser: advertiserIds.length > 0,
    targets,
    allOrgs,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Map</h1>
        <p className="text-muted-foreground mt-1">
          Your organization&apos;s service area and your ad targets in one place. To change an area,
          use the form where you set it.
        </p>
      </div>
      {layers.length === 0 ? (
        <div className="text-muted-foreground space-y-2 rounded-md border p-6 text-sm">
          <p>Nothing to show on the map yet.</p>
          <p>
            Search &amp; rescue teams:{" "}
            <Link href="/sar/new" className="font-medium underline">
              register your organization
            </Link>{" "}
            to set a service area.
          </p>
        </div>
      ) : (
        <MapView layers={layers} />
      )}
    </div>
  );
}
