"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { lookupShareLogAction, type ShareLogLookup } from "./actions";

const FIELD_LABEL: Record<string, string> = {
  userDisplayName: "name",
  lastFix: "location",
  plannedRoute: "planned route",
  note: "note",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });
}

export function ShareLogLookupForm({ requestId, suggestedAccountId }: { requestId: string; suggestedAccountId: string | null }) {
  const [state, action, pending] = useActionState<ShareLogLookup | null, FormData>(lookupShareLogAction, null);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <div className="space-y-1">
          <Label htmlFor={`acct-${requestId}`}>AvAI account id</Label>
          <Input
            id={`acct-${requestId}`}
            name="accountId"
            defaultValue={suggestedAccountId ?? ""}
            placeholder="from the AvServ deletion step"
            className="w-[22rem] font-mono text-xs"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Looking up…" : "Teams that received data"}
        </Button>
      </form>
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state?.ok ? (
        <div className="space-y-2 text-sm">
          {state.summary.status === "error" ? (
            <p role="alert" className="text-red-600">
              No AvAI server answered ({state.summary.unavailable.map((u) => `${u.node}: ${u.code}`).join(", ")}). This is
              not &quot;no teams&quot;. Try again before replying to the requester.
            </p>
          ) : (
            <>
              {state.summary.status === "incomplete" ? (
                <p role="alert" className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                  {`Incomplete: ${state.summary.unavailable.map((u) => `${u.node} (${u.code})`).join(", ")} didn't answer. Teams only it sent to are missing. Look up again before relying on this.`}
                </p>
              ) : null}
              {state.summary.teams.length === 0 ? (
                <p className="text-muted-foreground">
                  No team received this account&apos;s data{state.summary.status === "incomplete" ? " on the servers that answered" : ""}.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {state.summary.teams.map((t) => (
                    <li key={t.teamId} className="px-3 py-2">
                      <span className="font-medium">{state.teamNames[t.teamId] ?? `Unknown team ${t.teamId}`}</span>
                      <span className="text-muted-foreground block text-xs">
                        {t.dispatches} alert{t.dispatches === 1 ? "" : "s"}, {t.feedReads} map view{t.feedReads === 1 ? "" : "s"} ·{" "}
                        {t.fields.map((f) => FIELD_LABEL[f] ?? f).join(", ") || "no fields"} ·{" "}
                        {t.channels.join(", ") || "map only"} · {when(t.first)}
                        {t.first.slice(0, 10) !== t.last.slice(0, 10) ? `–${when(t.last)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {state.summary.drillRowsSkipped > 0 ? (
                <p className="text-muted-foreground text-xs">{state.summary.drillRowsSkipped} drill rows skipped.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
