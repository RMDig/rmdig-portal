// Shapes of the AvAI user agreement as the portal pins it (docs/plans/31 §4).
// AvServ publishes each version's markdown text plus the assent line and the
// attestation labels (contract account_agreement.md §2); the portal pins all of
// it at build time and renders it exactly. Hashes are never stored here — they
// are computed from these strings (lib/agreement/index.ts), because the hash we
// send must be the hash of what we rendered.

export interface PinnedAttestation {
  id: string;
  text: string;
  required: boolean;
}

export interface PinnedAgreement {
  version: string;
  /** Markdown source, UTF-8, LF line endings, no BOM — hashed byte for byte. */
  text: string;
  assent: { text: string };
  attestations: PinnedAttestation[];
}
