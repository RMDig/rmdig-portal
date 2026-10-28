"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EraseOutcome, PreviewNode, PreviewVerdict, StatusSummary } from "@/lib/deletion/erasure";

import {
  eraseAccountAction,
  erasureStatusAction,
  previewErasureAction,
  type EraseResult,
  type PreviewResult,
  type StatusResult,
} from "./erasure-actions";

// Runbook step 3 from the queue: check every AvServ node, erase on one, read
// the result back from every node. Nothing runs on page load; every call is
// a click. See erasure-actions.ts for the rules.

const REAUTH_HREF = `/settings/reauth?returnTo=${encodeURIComponent("/admin/deletion-requests")}`;

const LIVE_KIND: Record<string, string> = {
  checkout: "a check-out",
  help_request: "a Send Help",
  incident: "an incident",
  sar_message: "a SAR message in flight",
};

function Problem({ state }: { state: { ok: false; error: string; reauth?: true } }) {
  return (
    <p role="alert" className="text-sm text-red-600">
      {state.error}{" "}
      {state.reauth ? (
        <Link href={REAUTH_HREF} className="underline">
          Confirm it&apos;s you
        </Link>
      ) : null}
    </p>
  );
}

function previewNodeText(n: PreviewNode): { text: string; tone: "ok" | "warn" | "bad" } {
  switch (n.state) {
    case "erasable":
      return { text: "erasable", tone: "ok" };
    case "already_erased":
      return { text: "already erased", tone: "ok" };
    case "live":
      return {
        text: `blocked by ${n.live.map((l) => LIVE_KIND[l.kind] ?? l.kind).join(", ")}. Wait for it to close; never close it to erase.`,
        tone: "warn",
      };
    case "not_found":
      return { text: "doesn't have this account yet (replication). Try again in a few minutes.", tone: "warn" };
    case "unavailable":
      return { text: `not ready (${n.code}). Erase only when every node answers erasable.`, tone: "bad" };
  }
}

const TONE = { ok: "", warn: "text-amber-800 dark:text-amber-200", bad: "text-red-600" } as const;

function PreviewTable({ verdict }: { verdict: PreviewVerdict }) {
  return (
    <ul className="divide-y rounded-md border text-sm">
      {verdict.nodes.map((n) => {
        const { text, tone } = previewNodeText(n);
        return (
          <li key={n.node} className="px-3 py-2">
            <span className="font-mono text-xs">{n.node}</span> <span className={TONE[tone]}>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function outcomeText(o: EraseOutcome): { text: string; tone: "ok" | "warn" | "bad" } {
  switch (o.kind) {
    case "erased":
      return { text: o.record.alreadyErased ? "Already erased." : "Erased.", tone: "ok" };
    case "blocked":
      return { text: "Blocked: live safety state appeared since the check. Nothing was erased. Wait for it to close.", tone: "warn" };
    case "stop":
      return {
        text:
          o.code === "email_mismatch"
            ? "Stopped: this account's email isn't the requester's. Nothing was erased. Don't retry: review which account this request covers."
            : "Stopped: this account was created after the request was confirmed. Nothing was erased. Don't retry: review it.",
        tone: "bad",
      };
    case "later":
      return {
        text:
          o.code === "preview_changed"
            ? "Not every node is ready any more (see below). Nothing was sent."
            : o.code === "account_not_found"
              ? "The server doesn't have this account yet. Nothing was erased. Try after replication."
              : `Nothing was erased (${o.code}).${o.retryAfterSec ? ` Try again in about ${Math.ceil(o.retryAfterSec / 60)} min.` : " Try again later."}`,
        tone: "warn",
      };
    case "fault":
      return { text: `Nothing was erased: the portal's call failed (${o.code}). It has been reported.`, tone: "bad" };
    case "unknown":
      return { text: "No answer from the server, so it may or may not have run. Here is what every node holds now:", tone: "warn" };
  }
}

function StatusTable({ status, note }: { status: StatusSummary; note?: string }) {
  const label = {
    erased: "Erased on every node.",
    held: "Erased, but a node is holding it behind a live item. It applies when that item closes; check again later.",
    not_erased: "Not erased on any node.",
    incomplete: "A node didn't answer, so this is incomplete.",
  }[status.overall];
  return (
    <div className="space-y-2 text-sm">
      <p className={status.overall === "erased" ? "font-medium" : "text-amber-800 dark:text-amber-200"}>{label}</p>
      <ul className="divide-y rounded-md border">
        {status.nodes.map((n) => (
          <li key={n.node} className="px-3 py-2">
            <span className="font-mono text-xs">{n.node}</span>{" "}
            {n.state === "erased"
              ? `erased ${n.record.appliedAt} (origin ${n.record.originNode}, by ${n.record.reader ?? "?"})`
              : n.state === "not_erased"
                ? "not erased"
                : `didn't answer (${n.code})`}
          </li>
        ))}
      </ul>
      {note ? (
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">For the completion note below:</p>
          <pre className="bg-muted rounded-md p-2 text-xs whitespace-pre-wrap">{note}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function ErasurePanel({ requestId, suggestedAccountId }: { requestId: string; suggestedAccountId: string | null }) {
  const [accountId, setAccountId] = useState(suggestedAccountId ?? "");
  const [confirm, setConfirm] = useState("");
  const [preview, previewAction, previewing] = useActionState<PreviewResult | null, FormData>(previewErasureAction, null);
  const [erase, eraseAction, erasing] = useActionState<EraseResult | null, FormData>(eraseAccountAction, null);
  const [status, statusAction, reading] = useActionState<StatusResult | null, FormData>(erasureStatusAction, null);
  const id = accountId.trim();
  const canErase = preview?.ok === true && preview.verdict.canErase && confirm.trim() === id && id !== "";
  const outcome = erase?.ok ? outcomeText(erase.outcome) : null;

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">Erase in AvServ</h3>
      <div className="space-y-1">
        <Label htmlFor={`erase-account-${requestId}`}>Account to erase (AvAI account id)</Label>
        <Input
          id={`erase-account-${requestId}`}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="from the lookup above"
          className="max-w-md font-mono"
        />
      </div>

      <form action={previewAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="accountId" value={id} />
        <Button type="submit" variant="outline" size="sm" disabled={previewing || !id}>
          {previewing ? "Checking…" : "Check every node"}
        </Button>
      </form>
      {preview && !preview.ok ? <Problem state={preview} /> : null}
      {preview?.ok ? <PreviewTable verdict={preview.verdict} /> : null}

      {preview?.ok && preview.verdict.canErase ? (
        <form action={eraseAction} className="space-y-2">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="accountId" value={id} />
          <Label htmlFor={`erase-confirm-${requestId}`}>Type the account id again to erase it. This can&apos;t be undone.</Label>
          <Input
            id={`erase-confirm-${requestId}`}
            name="confirmAccountId"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            className="max-w-md font-mono"
          />
          <Button type="submit" variant="destructive" size="sm" disabled={erasing || !canErase}>
            {erasing ? "Erasing…" : "Erase this account"}
          </Button>
        </form>
      ) : null}
      {erase && !erase.ok ? <Problem state={erase} /> : null}
      {outcome ? (
        <p
          role="status"
          className={`text-sm ${outcome.tone === "ok" ? "font-medium" : TONE[outcome.tone]}`}
        >
          {outcome.text}
        </p>
      ) : null}
      {erase?.ok && erase.verdict ? <PreviewTable verdict={erase.verdict} /> : null}
      {erase?.ok && erase.status ? <StatusTable status={erase.status} note={erase.note} /> : null}

      <form action={statusAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="accountId" value={id} />
        <Button type="submit" variant="ghost" size="sm" disabled={reading || !id}>
          {reading ? "Reading…" : "Read erasure status on every node"}
        </Button>
      </form>
      {status && !status.ok ? <Problem state={status} /> : null}
      {status?.ok ? <StatusTable status={status.status} note={status.note} /> : null}
    </div>
  );
}
