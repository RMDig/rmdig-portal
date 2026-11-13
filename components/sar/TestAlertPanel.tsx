"use client";

import { useActionState } from "react";

import { sendDrillTestAlertAction } from "@/app/(portal)/admin/sar-drill/test-alert-actions";
import { sendTestAlertAction } from "@/app/(portal)/admin/sar-approvals/test-alert-actions";
import { Button } from "@/components/ui/button";
import { formatMountain } from "@/lib/format/time";
import type { TestAlertRow } from "@/lib/sar/test-alert";
import { CHANNEL_RESULT_LABEL } from "@/lib/sar/test-alert-rules";

// The staff half of the test alert: send it from every node, and see what
// each node reported and what the team has proved. For a team under review
// it is checklist item 3 (plan 33 §6.9 G2); for a drill team it is sent from
// Drill teams. A drill team's message comes to the portal's drill intake
// (/api/sar/intake/drill, AvServ's drill sink) and its email goes to the drill
// inbox, never a team address (AvServ plan 66 R1); the proofs are the same.
// Outside any other form: it's its own action, and forms don't nest.

// Each proof says plainly whether it has happened yet.
const proved = (yes: boolean, done: string, notYet: string) => (
  <span className={yes ? "text-green-800 dark:text-green-300" : "text-muted-foreground"}>{yes ? `✓ ${done}` : notYet}</span>
);

function NodeLine({ row, drill }: { row: TestAlertRow; drill: boolean }) {
  if (row.error) {
    return (
      <li>
        <span className="font-medium">{row.node}</span>: <span className="text-red-700 dark:text-red-400">failed ({row.error})</span>
      </li>
    );
  }
  const channel = (result: string | null, detail: string | null) => `${CHANNEL_RESULT_LABEL[result ?? ""] ?? result ?? "no result"}${detail ? ` (${detail})` : ""}`;
  return (
    <li className="space-y-0.5">
      <span className="font-medium">{row.node}</span>
      <span className="block pl-4">
        {drill ? "Portal (drill intake)" : "Portal"}: {channel(row.portal, row.portalDetail)} · {proved(row.portalArrived, "arrived", "not arrived yet")} ·{" "}
        {proved(row.portalReceived, "marked received", "not marked received yet")}
      </span>
      <span className="block pl-4">
        {drill ? "Email (drill inbox)" : "Email"}: {channel(row.email, row.emailDetail)} · {proved(row.emailConfirmed, "code entered", "code not entered yet")}
      </span>
    </li>
  );
}

export function TestAlertPanel({ orgId, rows, canSend, drill = false }: { orgId: string; rows: TestAlertRow[]; canSend: boolean; drill?: boolean }) {
  const [state, action, pending] = useActionState(drill ? sendDrillTestAlertAction : sendTestAlertAction, null);
  const sentAt = rows[0] ? new Date(rows[0].requestedAt) : null;
  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{drill ? "Drill test alert" : "Test alert (checklist item 3)"}</p>
        <p className="text-muted-foreground">{sentAt ? `Latest sent ${formatMountain(sentAt)}` : "None sent yet"}</p>
      </div>
      {rows.length ? <ul className="space-y-1">{rows.map((r) => <NodeLine key={r.id} row={r} drill={drill} />)}</ul> : null}
      {canSend ? (
        <form action={action}>
          <input type="hidden" name="orgId" value={orgId} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {rows.length ? "Send a new test" : "Send test alert"}
          </Button>
        </form>
      ) : null}
      {state ? <p className={state.ok ? "text-green-700" : "text-red-600"}>{state.ok ? state.message : state.error}</p> : null}
      <p className="text-muted-foreground text-xs">
        {drill ? (
          <>
            Each node sends a drill message to the portal&apos;s drill intake and an email with a code to the drill inbox,
            never to a team address. A drill login marks each message received and enters each code on the team&apos;s
            Alerts page; reload here to see it.
          </>
        ) : (
          <>
            Each node sends a message to the team&apos;s portal and an email with a code to its confirmed on-call address.
            The team marks each message received and enters each code on its Alerts page; reload here to see it.
          </>
        )}
      </p>
    </div>
  );
}
