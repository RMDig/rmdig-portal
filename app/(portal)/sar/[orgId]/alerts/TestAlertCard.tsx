"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import type { TestAlertRow } from "@/lib/sar/test-alert";
import { CHANNEL_RESULT_LABEL } from "@/lib/sar/test-alert-rules";

import { confirmTestCodeAction, markTestReceivedAction } from "./test-alert-actions";

// The team's half of the test alert (plan 33 §6.9 G2 item 3): for each AvAI
// server, mark its portal message received and enter the code its email
// carried. A test is never an alert; it names nobody and nowhere.

function MarkReceived({ orgId, row }: { orgId: string; row: TestAlertRow }) {
  const [state, action, pending] = useActionState(markTestReceivedAction.bind(null, orgId), null);
  if (row.portalReceived || state?.ok) return <p className="text-sm text-green-700 dark:text-green-300">Portal message marked received.</p>;
  if (row.portal !== "delivered") {
    return <p className="text-sm text-red-700 dark:text-red-400">Portal message: {CHANNEL_RESULT_LABEL[row.portal ?? ""] ?? row.portal ?? "no result"}. Tell rmdig staff.</p>;
  }
  if (!row.portalArrived) return <p className="text-muted-foreground text-sm">Portal message: not here yet. Reload in a minute.</p>;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="testAlertId" value={row.id} />
      <p className="text-sm">The test message from this server arrived here.</p>
      <Button type="submit" size="sm" disabled={pending}>
        Mark received
      </Button>
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}

function EnterCode({ orgId, row }: { orgId: string; row: TestAlertRow }) {
  const [state, action, pending] = useActionState(confirmTestCodeAction.bind(null, orgId), null);
  if (row.emailConfirmed || state?.ok) return <p className="text-sm text-green-700 dark:text-green-300">Email code confirmed.</p>;
  if (row.email !== "accepted") {
    return <p className="text-sm text-red-700 dark:text-red-400">Email: {CHANNEL_RESULT_LABEL[row.email ?? ""] ?? row.email ?? "no result"}. Tell rmdig staff.</p>;
  }
  if (row.codeAttemptsLeft === 0) return <p className="text-sm text-red-700 dark:text-red-400">Too many wrong codes. Ask rmdig staff to send a new test.</p>;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="testAlertId" value={row.id} />
      <label className="block text-sm">
        Code from the test email to your on-call address
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="border-input mt-1 flex h-9 w-32 rounded-md border px-3 py-1 text-sm"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        Confirm code
      </Button>
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
    </form>
  );
}

export function TestAlertCard({ orgId, rows }: { orgId: string; rows: TestAlertRow[] }) {
  return (
    <section aria-labelledby="test-alert-heading" className="space-y-3 rounded-md border p-4">
      <h2 id="test-alert-heading" className="font-medium">
        Test messages
      </h2>
      <p className="text-muted-foreground text-sm">
        Before your team is activated, rmdig staff send a test from each AvAI server. It is a test, not an alert: it
        names no one and no place. For each server, confirm both the message here and the code in the email.
      </p>
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 py-3">
            <p className="text-sm font-medium">{row.node}</p>
            {row.error ? (
              <p className="text-sm text-red-700 dark:text-red-400">This server couldn&apos;t send the test ({row.error}). rmdig staff will send a new one.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <MarkReceived orgId={orgId} row={row} />
                <EnterCode orgId={orgId} row={row} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
