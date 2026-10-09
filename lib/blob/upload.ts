import { randomBytes } from "node:crypto";

import { get, put } from "@vercel/blob";

import { env } from "../env";
import { PROOF_DOC_TYPES, proofDocProblem } from "./proof-limits";

// Proof-of-status document upload to Vercel Blob (SAR onboarding, P1.4).
// Credentials: on Vercel, the store connection sets BLOB_STORE_ID and the
// function authenticates with Vercel's OIDC identity (no long-lived secret);
// BLOB_READ_WRITE_TOKEN remains for local development only. Neither being set
// is a misconfig and fails loud (CLAUDE_BOOTSTRAP §1.3, no silent failures),
// distinct from a bad file (ProofDocError) which the caller turns into a
// field error.
//
// Privacy: proof docs (501(c)(3) letters, county registrations, IDs on them)
// live in a PRIVATE Blob store. Nothing reads them by URL; staff open them only
// through /admin/sar-approvals/proof/[orgId], which checks the staff role and
// streams the bytes with getProofDoc (runbook "SAR proof documents").
// Documents uploaded before 2026-10-03 went to
// the old public store; getProofDoc still reads those by their public URL.

/** A user-correctable problem with the uploaded file (wrong type, too big,
 *  missing). The caller surfaces the message as a field error. */
export class ProofDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofDocError";
  }
}

export interface UploadedProofDoc {
  url: string;
}

/**
 * Validate and upload a SAR proof document. Throws {@link ProofDocError} for a
 * bad file (caller maps to a field error) and a plain Error for a misconfigured
 * Blob token (caller logs + shows a generic failure). The stored object name
 * carries a random component so the URL can't be guessed from the org name.
 */
export async function uploadProofDoc(file: File): Promise<UploadedProofDoc> {
  // The browser runs the same check (lib/blob/proof-limits.ts); this one is the gate.
  const problem = proofDocProblem(file);
  if (problem) throw new ProofDocError(problem);
  const ext = PROOF_DOC_TYPES.get(file.type);
  if (!ext) throw new ProofDocError("Document must be a PDF, PNG, or JPG.");

  // E2E hermeticity: the mock Playwright gate runs without a Blob token.
  // E2E_FAKE_BLOB=1 (set only by the Playwright web server) returns a
  // deterministic fake URL *after* the same validation, so the gate exercises
  // the full create flow with no external dependency and no junk objects in the
  // store. Production/preview never set this and always hit real Blob below.
  if (process.env.E2E_FAKE_BLOB === "1") {
    return { url: `https://blob.local/sar-proofs/${randomBytes(8).toString("hex")}.${ext}` };
  }

  const key = `sar-proofs/${randomBytes(16).toString("hex")}.${ext}`;
  const blob = await put(key, file, {
    access: "private",
    contentType: file.type,
    ...blobCredentials(),
  });
  return { url: blob.url };
}

/** A proof document as stored on the org row: a private-store URL, a legacy
 *  public-store URL (before 2026-10-03), or the E2E fake. */
export function proofDocAccess(url: string): "private" | "public" | "fake" {
  const host = new URL(url).hostname;
  if (host === "blob.local") return "fake";
  return host.endsWith(".public.blob.vercel-storage.com") ? "public" : "private";
}

/** Stream a proof document for staff review. Null when it no longer exists.
 *  The caller has already checked the staff role. */
export async function getProofDoc(url: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
} | null> {
  const access = proofDocAccess(url);
  if (access === "fake") return null;
  const result =
    access === "public" ? await get(url, { access: "public" }) : await get(url, { access: "private", ...blobCredentials() });
  if (!result) return null;
  // 304 only answers a conditional request, which this never sends.
  if (result.statusCode !== 200) throw new Error(`Blob get returned ${result.statusCode} for a proof document`);
  return { stream: result.stream, contentType: result.blob.contentType ?? "application/octet-stream" };
}

/** Which Blob credentials this environment uses. The store id (Vercel OIDC)
 *  wins when present; the SDK pairs it with the function's OIDC token. */
export function blobCredentials(): { storeId: string } | { token: string } {
  if (env.BLOB_STORE_ID) return { storeId: env.BLOB_STORE_ID };
  if (env.BLOB_READ_WRITE_TOKEN) return { token: env.BLOB_READ_WRITE_TOKEN };
  throw new Error(
    "No Vercel Blob credentials: set BLOB_STORE_ID (connect a Blob store to the project in " +
      "Vercel) or, for local development, BLOB_READ_WRITE_TOKEN — cannot upload SAR proof documents.",
  );
}
