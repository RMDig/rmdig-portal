// Proof-of-status document limits, shared by the browser check
// (app/(portal)/sar/ProofDocInput.tsx) and the server's (lib/blob/upload.ts).
// No server-only imports: the client bundle uses this file.
//
// 4 MB keeps a whole application under Vercel's 4.5 MB function request limit
// and under next.config.ts's server-action body limit. Over that limit Next.js
// refuses the request before the action runs, and the user gets the error page
// instead of a field error, so tests/unit/proof-doc-limits.test.ts pins the
// two together.
export const PROOF_DOC_MAX_BYTES = 4 * 1024 * 1024;

// Accepted document types → file extension. A county letter or determination
// letter is a PDF or a scan; nothing else is a plausible proof doc.
export const PROOF_DOC_TYPES: ReadonlyMap<string, string> = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);

export const PROOF_DOC_ACCEPT = [...PROOF_DOC_TYPES.keys()].join(",");

export const PROOF_DOC_LIMIT_LABEL = "4 MB";

/** Why a chosen file can't be submitted, or null when it can. */
export function proofDocProblem(file: { size: number; type: string }): string | null {
  if (file.size === 0) return "Attach your proof-of-status document.";
  if (file.size > PROOF_DOC_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return (
      `That file is ${mb} MB; documents must be ${PROOF_DOC_LIMIT_LABEL} or smaller. ` +
      "Try saving the PDF again at a smaller size, or scanning at a lower resolution."
    );
  }
  if (!PROOF_DOC_TYPES.has(file.type)) return "Document must be a PDF, PNG, or JPG.";
  return null;
}
