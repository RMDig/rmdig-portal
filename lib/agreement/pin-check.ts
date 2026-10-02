import { z } from "zod";

import { sha256Hex } from "./present";
import type { PinnedAgreement } from "./types";

// The CI check that the portal's pinned agreement is byte-identical to what
// AvServ publishes: text, assent line and every attestation (docs/plans/31 §6;
// contract account_agreement.md rev 2 §2, §4). Pure — the script supplies the
// node answers — so every row of the §6 table is unit-tested.

// Contract §2 version body.
export const AgreementVersionSchema = z.object({
  version: z.string().min(1),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["current", "accepted", "retired"]),
  effectiveAt: z.string().min(1),
  text: z.string(),
  assent: z.object({ text: z.string().min(1), textHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  attestations: z.array(
    z.object({
      id: z.string().min(1),
      text: z.string().min(1),
      textHash: z.string().regex(/^[0-9a-f]{64}$/),
      required: z.boolean(),
    }),
  ),
});
export type AgreementVersion = z.infer<typeof AgreementVersionSchema>;

/** What one node said. `http` covers every non-200 with AvServ's code. */
export type NodeAnswer =
  | { node: string; kind: "ok"; body: AgreementVersion }
  | { node: string; kind: "http"; status: number; code?: string }
  | { node: string; kind: "unreachable"; message: string };

export type CheckMode = "pr" | "daily";

export interface CheckResult {
  outcome: "pass" | "warn" | "fail";
  messages: string[];
}

/** The path to ask for: the pinned version, or `current` when nothing is pinned. */
export function checkPath(pinned: PinnedAgreement | null): string {
  return pinned
    ? `/v1/agreement/${encodeURIComponent(pinned.version)}`
    : "/v1/agreement/current";
}

// A node's answer settles the question unless it is a server-side condition
// another node may not share (contract §2: 503 "another node may answer").
function authoritative(a: NodeAnswer): boolean {
  return a.kind === "ok" || (a.kind === "http" && a.status < 500);
}

/** Every difference between the pinned copy and AvServ's published version. */
export function diffPinned(pinned: PinnedAgreement, published: AgreementVersion): string[] {
  const diffs: string[] = [];
  if (published.version !== pinned.version) {
    diffs.push(`version: pinned ${pinned.version}, AvServ ${published.version}`);
  }
  if (sha256Hex(pinned.text) !== published.contentHash) {
    diffs.push("text: pinned hash differs from AvServ contentHash");
  }
  if (sha256Hex(pinned.assent.text) !== published.assent.textHash) {
    diffs.push("assent: pinned wording hash differs from AvServ");
  }
  const pinnedIds = pinned.attestations.map((a) => a.id).sort();
  const publishedIds = published.attestations.map((a) => a.id).sort();
  if (pinnedIds.join(",") !== publishedIds.join(",")) {
    diffs.push(`attestations: pinned [${pinnedIds.join(", ")}], AvServ [${publishedIds.join(", ")}]`);
  }
  for (const p of pinned.attestations) {
    const q = published.attestations.find((x) => x.id === p.id);
    if (!q) continue;
    if (sha256Hex(p.text) !== q.textHash) diffs.push(`attestation ${p.id}: wording hash differs`);
    if (p.required !== q.required) diffs.push(`attestation ${p.id}: required differs`);
  }
  return diffs;
}

export function evaluatePin(
  pinned: PinnedAgreement | null,
  answers: NodeAnswer[],
  mode: CheckMode,
): CheckResult {
  const answer = answers.find(authoritative);
  if (!answer) {
    const why = answers.map((a) => `${a.node}: ${describe(a)}`).join("; ") || "no nodes configured";
    // PRs must not be blocked by an AvServ outage; the daily run insists.
    return {
      outcome: mode === "daily" ? "fail" : "warn",
      messages: [`No AvServ node gave an authoritative answer (${why}).`],
    };
  }
  const from = `(from ${answer.node})`;

  if (!pinned) {
    if (answer.kind === "http" && answer.status === 404 && answer.code === "agreement_not_published") {
      return { outcome: "pass", messages: [`Nothing pinned and nothing published ${from}.`] };
    }
    if (answer.kind === "ok") {
      const msg = `AvServ published ${answer.body.version} ${from}, but the portal pins nothing: run \`pnpm agreement:pin ${answer.body.version}\`.`;
      return { outcome: mode === "daily" ? "fail" : "warn", messages: [msg] };
    }
    return { outcome: "fail", messages: [`Unexpected answer for /current ${from}: ${describe(answer)}.`] };
  }

  if (answer.kind !== "ok") {
    return {
      outcome: "fail",
      messages: [`Pinned version ${pinned.version} is not served by AvServ ${from}: ${describe(answer)}.`],
    };
  }
  const diffs = diffPinned(pinned, answer.body);
  if (diffs.length > 0) {
    return {
      outcome: "fail",
      messages: [`Pinned ${pinned.version} does not match AvServ ${from}:`, ...diffs.map((d) => `  - ${d}`)],
    };
  }
  if (answer.body.status !== "current") {
    return {
      outcome: "warn",
      messages: [
        `Pinned ${pinned.version} matches AvServ ${from} but is "${answer.body.status}", not current: pin the current version before it is retired.`,
      ],
    };
  }
  return { outcome: "pass", messages: [`Pinned ${pinned.version} matches AvServ ${from}.`] };
}

function describe(a: NodeAnswer): string {
  if (a.kind === "ok") return `200 ${a.body.version}`;
  if (a.kind === "http") return `${a.status}${a.code ? ` ${a.code}` : ""}`;
  return `unreachable (${a.message})`;
}
