"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { runChecksAction, type ChecksOutcome } from "./actions";
import { formatMountain } from "@/lib/format/time";

export function ChecksRunner() {
  const [state, action, pending] = useActionState<ChecksOutcome | null, FormData>(runChecksAction, null);
  const nodes = state?.ok ? [...new Set(state.results.map((r) => r.node))] : [];
  const checks = state?.ok ? [...new Set(state.results.map((r) => r.check))] : [];
  return (
    <div className="space-y-4">
      <form action={action}>
        <Button type="submit" disabled={pending}>
          {pending ? "Running…" : "Run checks"}
        </Button>
      </form>
      {state && !state.ok ? <p className="text-sm text-red-600">{state.error}</p> : null}
      {state?.ok ? (
        <>
          <p className="text-sm">
            {state.results.every((r) => r.ok)
              ? "Every check passed on every node."
              : `${state.results.filter((r) => !r.ok).length} check(s) failed. A 403 or path_not_allowed means our key lacks that route group on that node.`}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4 font-medium">Check</th>
                  <th className="py-2 pr-4 font-medium">Route group</th>
                  {nodes.map((n) => (
                    <th key={n} className="py-2 pr-4 font-medium">
                      {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => {
                  const row = state.results.filter((r) => r.check === c);
                  return (
                    <tr key={c} className="border-b last:border-0">
                      <td className="py-2 pr-4">{c}</td>
                      <td className="text-muted-foreground py-2 pr-4 font-mono text-xs">{row[0]?.group}</td>
                      {nodes.map((n) => {
                        const r = row.find((x) => x.node === n);
                        return (
                          <td key={n} className={`py-2 pr-4 ${r?.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`}>
                            {r ? `${r.ok ? "Pass" : "Fail"}: ${r.answer}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">Run at {formatMountain(new Date(state.at))}.</p>
        </>
      ) : null}
    </div>
  );
}
