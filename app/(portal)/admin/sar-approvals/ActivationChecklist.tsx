"use client";

import { useState } from "react";

import {
  type ActivationFacts,
  CHECKLIST_LABEL,
  checklistReady,
  judgeChecklist,
  type ChecklistItem,
} from "@/lib/sar/activation-checklist-rules";

// The activation checklist inside the Approve form (plan 33 §6.9 G2). The
// approver records the call-back and confirms the terms; the rest is read
// from the team. The action judges it again with fresh facts and records it.
// `onReady` reports whether Approve may be pressed.

const STATUS_STYLE: Record<ChecklistItem["status"], string> = {
  pass: "text-green-800 dark:text-green-300",
  fail: "text-red-700 dark:text-red-400",
  pending: "text-amber-800 dark:text-amber-300",
};
const STATUS_WORD: Record<ChecklistItem["status"], string> = { pass: "Done", fail: "Not yet", pending: "Pending" };

export function ActivationChecklist({ facts, onReady }: { facts: ActivationFacts; onReady: (ready: boolean) => void }) {
  const [answers, setAnswers] = useState({ callbackNumber: "", callbackSpokeTo: "", termsFloor: false, largeAreaResolved: false });
  const items = judgeChecklist(facts, answers);
  const update = (next: Partial<typeof answers>) => {
    const merged = { ...answers, ...next };
    setAnswers(merged);
    onReady(checklistReady(judgeChecklist(facts, merged)));
  };

  return (
    <fieldset className="space-y-3 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Activation checklist (beta, single review)</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block">Number you called (the team&apos;s publicly listed one)</span>
          <input
            name="callbackNumber"
            value={answers.callbackNumber}
            onChange={(e) => update({ callbackNumber: e.target.value })}
            className="border-input flex h-9 w-full rounded-md border px-3 py-1 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">Who you spoke to</span>
          <input
            name="callbackSpokeTo"
            value={answers.callbackSpokeTo}
            onChange={(e) => update({ callbackSpokeTo: e.target.value })}
            className="border-input flex h-9 w-full rounded-md border px-3 py-1 text-sm"
          />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="termsFloor" checked={answers.termsFloor} onChange={(e) => update({ termsFloor: e.target.checked })} className="mt-1" />
        <span>The published terms carry counsel&apos;s floor clauses</span>
      </label>
      {facts.largeArea ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="largeAreaResolved"
            checked={answers.largeAreaResolved}
            onChange={(e) => update({ largeAreaResolved: e.target.checked })}
            className="mt-1"
          />
          <span>The large-area warning is resolved: I checked the area with the team</span>
        </label>
      ) : null}
      <ul className="space-y-1 text-sm">
        {items.map((i) => (
          <li key={i.id}>
            <span className={`font-medium ${STATUS_STYLE[i.status]}`}>{STATUS_WORD[i.status]}</span> · {CHECKLIST_LABEL[i.id]}
            <span className="text-muted-foreground block pl-4">{i.detail}</span>
          </li>
        ))}
      </ul>
      {items.some((i) => i.id === "test_alert" && i.status === "pending") ? (
        <p className="text-muted-foreground text-xs">
          A real team can&apos;t be approved until AvServ&apos;s test alert exists and passes on every node (owner,
          2026-11-11).
        </p>
      ) : null}
    </fieldset>
  );
}
