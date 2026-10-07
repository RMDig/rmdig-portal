"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { lookupAccountsAction, lookupShareLogAction, type AccountLookup, type ShareLogLookup } from "./actions";
import { formatMountainDate } from "@/lib/format/time";

const FIELD_LABEL: Record<string, string> = {
  userDisplayName: "name",
  lastFix: "location",
  plannedRoute: "planned route",
  note: "note",
};

function when(iso: string): string {
  return formatMountainDate(new Date(iso));
}

export function ShareLogLookupForm({ requestId, suggestedAccountId }: { requestId: string; suggestedAccountId: string | null }) {
  const [state, action, pending] = useActionState<ShareLogLookup | null, FormData>(lookupShareLogAction, null);
  const [found, findAction, finding] = useActionState<AccountLookup | null, FormData>(lookupAccountsAction, null);
  const [accountId, setAccountId] = useState(suggestedAccountId ?? "");
  return (
    <div className="space-y-3">
      <form action={findAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <Button type="submit" variant="ghost" size="sm" disabled={finding}>
          {finding ? "Finding…" : "Find AvAI accounts for this email"}
        </Button>
      </form>
      {found && !found.ok ? <p className="text-sm text-red-600">{found.error}</p> : null}
      {found?.ok ? (
        <div className="space-y-2 text-sm">
          {found.status === "error" ? (
            <p role="alert" className="text-red-600">
              {`No AvAI server answered (${found.unavailable.map((u) => `${u.node}: ${u.code}`).join(", ")}). This is not "no accounts".`}
            </p>
          ) : (
            <>
              {found.status === "incomplete" ? (
                <p role="alert" className="text-amber-800 dark:text-amber-200">
                  {`Incomplete: ${found.unavailable.map((u) => `${u.node} (${u.code})`).join(", ")} didn't answer. An account only it holds may be missing.`}
                </p>
              ) : null}
              {found.matches.length === 0 ? (
                <p className="text-muted-foreground">No AvAI account carries this email.</p>
              ) : (
                <>
                  <p className="text-muted-foreground text-xs">
                    Only a login match is verified. An app email isn&apos;t, and several accounts can carry the same
                    one: confirm the requester controls each account before deleting it.
                  </p>
                  <ul className="divide-y rounded-md border">
                    {found.matches.map((m) => (
                      <li key={m.accountId} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span>
                          <span className="font-mono text-xs">{m.accountId}</span>
                          <span className="text-muted-foreground block text-xs">
                            {m.verified ? "verified (login email)" : "unverified (app email)"} · {m.status} · created {when(m.createdAt)}
                          </span>
                        </span>
                        <Button type="button" size="sm" variant="outline" onClick={() => setAccountId(m.accountId)}>
                          Use
                        </Button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      ) : null}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <div className="space-y-1">
          <Label htmlFor={`acct-${requestId}`}>AvAI account id</Label>
          <Input
            id={`acct-${requestId}`}
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="find it above, or from the AvServ deletion step"
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
