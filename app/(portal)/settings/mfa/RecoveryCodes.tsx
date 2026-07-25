"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

// Client-side only: the codes are already in the browser (they're on screen),
// so building the file here adds no exposure — nothing extra crosses the wire
// and no server route ever serves plaintext codes.
function downloadCodes(codes: string[]) {
  const content = [
    "rmdig / AvAI — MFA recovery codes",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Each code works once if you lose your authenticator.",
    "Store this file somewhere safe, then delete it from Downloads.",
    "",
    ...codes,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "rmdig-recovery-codes.txt";
  a.click();
  URL.revokeObjectURL(url);
}

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
      <Button type="button" variant="outline" onClick={() => downloadCodes(codes)}>
        <Download className="size-4" />
        Download as .txt
      </Button>
    </div>
  );
}
