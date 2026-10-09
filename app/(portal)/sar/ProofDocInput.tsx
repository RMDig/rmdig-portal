"use client";

import { useEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { PROOF_DOC_ACCEPT, proofDocProblem } from "@/lib/blob/proof-limits";

import { FieldError } from "./SarOrgFields";

// The proof-document file input for /sar/new and the edit-and-resubmit form.
// It checks the file as soon as it's chosen and clears one that can't be sent,
// so an oversized document gets a hint here instead of the request failing
// (Next.js refuses an over-limit body before the server action runs, which
// shows the error page). The server re-checks in lib/blob/upload.ts.
//
// The native input is visually hidden but stays in the form, so keyboard
// focus, the browser's "required" check and the upload all still use it; the
// visible control is an outlined button (its label), with the chosen file's
// name on its own line below.
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
  const [fileName, setFileName] = useState<string | null>(null);
  const errors = problem ? [problem] : serverErrors;
  const inputRef = useRef<HTMLInputElement>(null);

  // React resets the form after a rejected submit, which empties the file
  // input; the name shown below must not claim a file is still attached.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const clear = () => setFileName(null);
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id="proofDoc"
        name="proofDoc"
        type="file"
        accept={PROOF_DOC_ACCEPT}
        required={required}
        className="peer sr-only"
        aria-label={ariaLabel ?? "Proof-of-status document"}
        aria-invalid={!!errors?.length}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const found = file ? proofDocProblem(file) : null;
          if (found) e.target.value = "";
          setProblem(found);
          setFileName(file && !found ? file.name : null);
        }}
      />
      <label
        htmlFor="proofDoc"
        className={`${buttonVariants({ variant: "outline" })} cursor-pointer peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50`}
      >
        {fileName ? "Choose a different file" : "Choose file"}
      </label>
      <p className="text-muted-foreground text-sm break-all">{fileName ?? "No file chosen"}</p>
      <FieldError errors={errors} />
    </div>
  );
}
