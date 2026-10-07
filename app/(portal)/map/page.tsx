import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { redirectToSignIn } from "@/lib/auth/sign-in-redirect";
import { userMfaGate } from "@/lib/auth/mfa-gate";
import { layersFor } from "@/lib/map/layers";
import { advertiserIdsFor, allOrgRows, dispatchOrgsFor, memberOrgRows, targetRows } from "@/lib/map/queries";
import { loadRedLayers } from "@/lib/map/red-read";

import { MapView } from "./MapView";

export const metadata = { title: "Map — rmdig" };

// One map for every role (docs/plans/33, Phase 1): each viewer sees only their
// own organizations' service areas and their own ad targets; staff also see
// every organization. View-only: editing an approved org's area would change
// where alerts route without review (CLAUDE.md §0), so changes stay on the
// existing forms. Scoped here on the server, re-checking the session rather
// than trusting the layout.
//
// Team admins and dispatchers also get their team's RED layer (lib/map/red-read).
export default async function MapPage() {
  const session = await auth();
  if (!session?.user?.id) return redirectToSignIn();
  const userId = session.user.id;
  // Next renders this page alongside the layout's MFA redirect, and this page
  // reads alerts from AvServ (which logs the disclosure) and logs the view.
  const { gate, roles } = await userMfaGate(userId);
  if (gate === "required") redirect("/settings/mfa/enroll");

  const [memberOrgs, advertiserIds, dispatchOrgs] = await Promise.all([
    memberOrgRows(userId),
    advertiserIdsFor(userId),
    dispatchOrgsFor(userId),
  ]);
  const isStaff = roles.length > 0;
  const [targets, allOrgs] = await Promise.all([
    targetRows(advertiserIds),
    isStaff ? allOrgRows() : Promise.resolve(null),
  ]);

  const red = await loadRedLayers(userId, dispatchOrgs);
  const layers = [...red, ...layersFor({
    isStaff,
    memberOrgs,
    isAdvertiser: advertiserIds.length > 0,
    targets,
    allOrgs,
  })];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Map</h1>
        <p className="text-muted-foreground text-sm">View only. To change an area, use the form where you set it.</p>
      </div>
      {layers.length === 0 ? (
        <div className="text-muted-foreground space-y-2 rounded-md border p-6 text-sm">
          <p>Nothing to show on the map yet.</p>
          <p>
            Search &amp; rescue teams:{" "}
            <Link href="/sar/new" className="font-medium underline">
              register your team
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
