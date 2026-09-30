import { createHash } from "node:crypto";

import type { PinnedAgreement } from "./types";

// Env-free hashing and presentation of a pinned agreement, shared by the app
// (lib/agreement/index.ts) and the pin/check scripts, which must run without
// the app's environment. Every hash is computed from the exact strings the
// portal renders (contract account_agreement.md §2).

/** Lowercase hex sha256 of a string's UTF-8 bytes — the contract's hash. */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface PresentedAttestation {
  id: string;
  text: string;
  textHash: string;
  required: boolean;
}

export interface PresentedAgreement {
  version: string;
  text: string;
  contentHash: string;
  assent: { text: string; textHash: string };
  attestations: PresentedAttestation[];
  /** True only for the E2E test fixture (never in production). */
  fixture: boolean;
}

/** Throws when pinned text could not hash to AvServ's value: AvServ hashes UTF-8
 *  with LF endings and no BOM, so a CR or BOM means a corrupted pin. */
export function assertPinnable(text: string): void {
  if (text.includes("\r")) throw new Error("agreement text contains CR; AvServ hashes LF-only text");
  if (text.startsWith("\uFEFF")) throw new Error("agreement text starts with a BOM");
}

export function present(pin: PinnedAgreement, fixture = false): PresentedAgreement {
  assertPinnable(pin.text);
  return {
    version: pin.version,
    text: pin.text,
    contentHash: sha256Hex(pin.text),
    assent: { text: pin.assent.text, textHash: sha256Hex(pin.assent.text) },
    attestations: pin.attestations.map((a) => ({ ...a, textHash: sha256Hex(a.text) })),
    fixture,
  };
}
