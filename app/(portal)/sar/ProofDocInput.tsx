"use client";

import { useState } from "react";

import { PROOF_DOC_ACCEPT, proofDocProblem } from "@/lib/blob/proof-limits";

import { FieldError } from "./SarOrgFields";

// The proof-document file input for /sar/new and the edit-and-resubmit form.
// It checks the file as soon as it's chosen and clears one that can't be sent,
// so an oversized document gets a hint here instead of the request failing
// (Next.js refuses an over-limit body before the server action runs, which
// shows the error page). The server re-checks in lib/blob/upload.ts.
export function ProofDocInput({
  required,
  ariaLabel,
  serverErrors,
}: {
  required: boolean;
  ariaLabel?: string;
  serverErrors?: string[];
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const errors = problem ? [problem] : serverErrors;

  return (
    <div className="space-y-2">
      <input
        id="proofDoc"
        name="proofDoc"
        type="file"
        accept={PROOF_DOC_ACCEPT}
        required={required}
        className="text-sm"
        aria-label={ariaLabel}
        aria-invalid={!!errors?.length}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const found = file ? proofDocProblem(file) : null;
          if (found) e.target.value = "";
          setProblem(found);
        }}
      />
      <FieldError errors={errors} />
    </div>
  );
}
