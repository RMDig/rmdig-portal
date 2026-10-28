import type { ErasurePreview, ErasureRecord, LiveItem, NodeResult } from "../avserv/erasure-types";

// What the operator's "Erase in AvServ" may do, from AvServ's answers
// (account_erasure.md rev 1). Pure, so every rule is tested. The rules:
//  - Erase only when EVERY node answers erasable or already erased; a node
//    that's unreachable, doesn't have the account yet, or has live safety
//    state blocks it. Never close a safety item to get past this.
//  - email_mismatch / account_newer_than_request: stop and review, never retry.
//  - No answer to the POST is unknown, not failed: read status, don't re-send.

export type PreviewNode =
  | { node: string; state: "erasable" | "already_erased" }
  | { node: string; state: "live"; live: LiveItem[] }
  | { node: string; state: "not_found" | "unavailable"; code: string };

export interface PreviewVerdict {
  canErase: boolean;
  nodes: PreviewNode[];
}

export function previewVerdict(results: NodeResult<ErasurePreview>[]): PreviewVerdict {
  const nodes = results.map((r): PreviewNode => {
    if (!r.ok) return { node: r.node, state: r.code === "account_not_found" ? "not_found" : "unavailable", code: r.code };
    if (r.value.alreadyErased) return { node: r.node, state: "already_erased" };
    if (r.value.live.length > 0) return { node: r.node, state: "live", live: r.value.live };
    // Not erasable with nothing live: the node's erasure setting is invalid.
    return r.value.erasable ? { node: r.node, state: "erasable" } : { node: r.node, state: "unavailable", code: "not_erasable" };
  });
  const canErase = nodes.length > 0 && nodes.every((n) => n.state === "erasable" || n.state === "already_erased");
  return { canErase, nodes };
}

export type EraseOutcome =
  | { kind: "erased"; record: ErasureRecord }
  /** Live safety state appeared since the preview; nothing erased. */
  | { kind: "blocked"; live: LiveItem[] }
  /** The account isn't this requester's: stop and review, never retry. */
  | { kind: "stop"; code: "email_mismatch" | "account_newer_than_request" }
  /** Nothing changed; try again later (cap, unavailable, not replicated yet). */
  | { kind: "later"; code: string; retryAfterSec?: number }
  /** Our bug or an uninstalled key: nothing changed, and it's reported. */
  | { kind: "fault"; code: string; status?: number }
  /** No answer: it may or may not have run. Read status on every node. */
  | { kind: "unknown" };

export function eraseOutcome(answer: NodeResult<ErasureRecord>): EraseOutcome {
  if (answer.ok) return { kind: "erased", record: answer.value };
  const { code, status } = answer;
  if (code === "unreachable") return { kind: "unknown" };
  if (code === "email_mismatch" || code === "account_newer_than_request") return { kind: "stop", code };
  if (code === "erasure_blocked_active") return { kind: "blocked", live: answer.live ?? [] };
  if (code === "erasure_rate_limited" || code === "erasure_unavailable" || code === "account_not_found") {
    return { kind: "later", code, ...(answer.retryAfterSec ? { retryAfterSec: answer.retryAfterSec } : {}) };
  }
  // A 5xx without a contract code is the node failing mid-call: it may have
  // run, so it's unknown like a timeout.
  if (status !== undefined && status >= 500) return { kind: "unknown" };
  return { kind: "fault", code, ...(status !== undefined ? { status } : {}) };
}

export type StatusNode =
  | { node: string; state: "erased"; record: ErasureRecord }
  | { node: string; state: "not_erased" }
  | { node: string; state: "unavailable"; code: string };

export interface StatusSummary {
  /** erased: every node has it. held: some have it, another doesn't yet
   *  (applied once its live item closes, AvServ ErasureHeldBehindLiveItem).
   *  not_erased: no node has it. incomplete: a node didn't answer. */
  overall: "erased" | "held" | "not_erased" | "incomplete";
  nodes: StatusNode[];
}

export function statusSummary(results: NodeResult<ErasureRecord>[]): StatusSummary {
  const nodes = results.map((r): StatusNode => {
    if (r.ok) return { node: r.node, state: "erased", record: r.value };
    return r.code === "not_erased" ? { node: r.node, state: "not_erased" } : { node: r.node, state: "unavailable", code: r.code };
  });
  const erased = nodes.filter((n) => n.state === "erased").length;
  const overall =
    nodes.some((n) => n.state === "unavailable") || nodes.length === 0
      ? "incomplete"
      : erased === nodes.length
        ? "erased"
        : erased > 0
          ? "held"
          : "not_erased";
  return { overall, nodes };
}

/** The AvServ part of the completion note, from the status read. */
export function completionNoteText(accountId: string, summary: StatusSummary): string {
  const records = summary.nodes.filter((n): n is Extract<StatusNode, { state: "erased" }> => n.state === "erased");
  const first = records[0]?.record;
  if (!first) return "";
  const rows = Object.entries(first.rows)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${t} ${n}`)
    .join(", ");
  const nodes = summary.nodes.map((n) => `${n.node}: ${n.state === "erased" ? "erased" : n.state.replace("_", " ")}`).join("; ");
  return `AvServ: erased AvAI account ${accountId} (origin ${first.originNode}, applied ${first.appliedAt}${rows ? `; rows ${rows}` : ""}). Status per node: ${nodes}.`;
}
