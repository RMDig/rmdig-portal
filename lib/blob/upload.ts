import { randomBytes } from "node:crypto";

import { put } from "@vercel/blob";

import { env } from "../env";

// Proof-of-status document upload to Vercel Blob (SAR onboarding, P1.4).
// Credentials: on Vercel, the store connection sets BLOB_STORE_ID and the
// function authenticates with Vercel's OIDC identity (no long-lived secret);
// BLOB_READ_WRITE_TOKEN remains for local development only. Neither being set
// is a misconfig and fails loud (CLAUDE_BOOTSTRAP §1.3, no silent failures),
// distinct from a bad file (ProofDocError) which the caller turns into a
// field error.
//
// Privacy note: Vercel Blob serves objects at an unguessable public URL — there
// is no per-request auth on the bytes. Proof docs (501(c)(3) letters, county
// registrations) are mildly sensitive, so the URL is treated as a secret: stored
// on the org row, shown only to the submitter and to platform reviewers. This is
// the Phase-1 simplicity tradeoff from rmdig-ai docs/plans/06; revisit if proof
// docs ever carry PII beyond org registration.

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Accepted document types → file extension. A county letter or determination
// letter is a PDF or a scan; nothing else is a plausible proof doc.
const ALLOWED_TYPES = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);

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
  if (file.size === 0) {
    throw new ProofDocError("Attach your proof-of-status document.");
  }
  if (file.size > MAX_BYTES) {
    throw new ProofDocError("Document must be 10 MB or smaller.");
  }
  const ext = ALLOWED_TYPES.get(file.type);
  if (!ext) {
    throw new ProofDocError("Document must be a PDF, PNG, or JPG.");
  }

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
    access: "public",
    contentType: file.type,
    ...blobCredentials(),
  });
  return { url: blob.url };
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
