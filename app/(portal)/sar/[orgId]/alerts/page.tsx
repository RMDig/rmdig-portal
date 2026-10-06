import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { formatMountain } from "@/lib/announcements/announcements";
import { auth } from "@/lib/auth";
import { userMfaGate } from "@/lib/auth/mfa-gate";
import { getOrgRole } from "@/lib/auth/org-roles";
import { db } from "@/lib/db";
import { sarAlertAcks, sarAlertViewLog, sarIntakeMessages, sarOrgs } from "@/lib/db/schema";
import { alertUserName, groupAlerts, type IntakePayload } from "@/lib/sar/intake";

import { AckButton } from "./AckButton";

export const metadata = { title: "Team alerts — rmdig" };

// A SAR team's alerts as AvServ delivered them on the portal channel
// (docs/plans/33; AvServ sar_portal_intake.md). Admins and dispatchers only.
// Every view is logged before any alert is shown. Copy never implies the team
// is watching anyone or responding; marking received is just that.
const KIND_LABEL = { overdue: "Missed check-in", send_help: "Send Help" } as const;
const STATE_LABEL = { open: "Open", resolved: "Resolved: the user checked in", retracted: "Retracted by the user" } as const;

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default async function TeamAlertsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) redirect("/dashboard");
  const role = await getOrgRole(session.user.id, orgId);
  if (role !== "admin" && role !== "dispatcher") redirect("/dashboard");
  // Next renders this page alongside the layout's MFA redirect, so check it
  // here too: a view that was never shown mustn't be read or logged.
  if ((await userMfaGate(session.user.id)).gate === "required") redirect("/settings/mfa/enroll");

  const [org] = await db.select({ name: sarOrgs.name }).from(sarOrgs).where(eq(sarOrgs.id, orgId)).limit(1);
  if (!org) redirect("/dashboard");

  const rows = await db
    .select()
    .from(sarIntakeMessages)
    .where(eq(sarIntakeMessages.orgId, orgId))
    .orderBy(desc(sarIntakeMessages.receivedAt))
    .limit(300);
  const alerts = groupAlerts(rows.map((r) => ({ ...r, payload: r.payload as IntakePayload })));
  const acks = new Map(
    (await db.select().from(sarAlertAcks).where(eq(sarAlertAcks.orgId, orgId))).map((a) => [a.alertId, a]),
  );

  // Log the viewing before showing anything (AvServ logs the disclosure).
  await db.insert(sarAlertViewLog).values({ orgId, userId: session.user.id, alertIds: alerts.map((a) => a.alertId) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}: alerts</h1>
        <p className="text-muted-foreground mt-1">
          Alerts AvAI sent to your team. Locations are the last ones the user&apos;s phone sent and may be old. In an
          emergency, call 911.
        </p>
      </div>

      {alerts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No alerts yet.</p>
      ) : (
        <ul className="space-y-4">
          {alerts.map((a) => {
            const ack = acks.get(a.alertId);
            return (
              <li key={a.alertId} className="space-y-2 rounded-md border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">
                    {KIND_LABEL[a.kind]}: {alertUserName(a.userDisplayName)}
                    {a.drill ? <span className="text-muted-foreground font-normal"> (drill)</span> : null}
                  </h2>
                  <span className={a.state === "open" ? "text-sm font-medium text-red-700 dark:text-red-400" : "text-muted-foreground text-sm"}>
                    {STATE_LABEL[a.state]}
                  </span>
                </div>
                <dl className="text-muted-foreground grid gap-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-foreground inline font-medium">Last location: </dt>
                    <dd className="inline">
                      {a.lastFix
                        ? `${a.lastFix.lat.toFixed(5)}, ${a.lastFix.lon.toFixed(5)}${a.lastFix.accuracyMeters != null ? ` (±${Math.round(a.lastFix.accuracyMeters)} m)` : ""}, ${a.lastFix.at ? ago(a.lastFix.at) : "fix time unknown"}`
                        : a.state === "open"
                          ? "none sent"
                          : "removed after the alert ended"}
                    </dd>
                  </div>
                  {a.expectedReturnAt ? (
                    <div>
                      <dt className="text-foreground inline font-medium">Expected back: </dt>
                      <dd className="inline">{formatMountain(new Date(a.expectedReturnAt))}</dd>
                    </div>
                  ) : null}
                  {a.note ? (
                    <div className="sm:col-span-2">
                      <dt className="text-foreground inline font-medium">Note: </dt>
                      <dd className="inline">{a.note}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-foreground inline font-medium">Received: </dt>
                    <dd className="inline">
                      {formatMountain(a.firstReceivedAt)}
                      {a.deliveries.length > 1 ? ` (delivered ${a.deliveries.length} times, one alert)` : ""}
                    </dd>
                  </div>
                </dl>
                {ack ? (
                  <p className="text-sm">Marked received {formatMountain(ack.ackedAt)}.</p>
                ) : a.state === "open" ? (
                  <div className="space-y-1">
                    <AckButton orgId={orgId} alertId={a.alertId} />
                    <p className="text-muted-foreground text-xs">
                      Tells the user&apos;s app that a team has seen the alert. It doesn&apos;t say you&apos;re responding,
                      and it doesn&apos;t stop or delay anything.
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
