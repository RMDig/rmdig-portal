"use client";

// Shown exactly once, right after codes are generated. We deliberately don't
// offer to re-show them — if lost, the user regenerates (which invalidates the
// old set). Kept as a plain list so copy/print works without extra wiring.
export function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
        Save these recovery codes somewhere safe. Each works once if you lose your authenticator.
        They won&apos;t be shown again.
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-4 font-mono text-sm tabular-nums">
        {codes.map((c) => (
          <li key={c} className="text-center tracking-widest">
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
