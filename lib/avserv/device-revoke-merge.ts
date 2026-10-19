import type { LinkedDevice } from "./client";
import type { NodeAnswer, Preview, RevokeAnswer, RevokeMode, RevokeOthersAnswer } from "./device-revoke-types";

// Pure merges of every node's answers (device_revoke.md rev 2: each node answers
// for itself; one success reaches the rest by replication). Unit-tested.

export type LiveSummary = { checkouts: number; helpRequests: number; other: number };

export interface MergedPreview {
  live: LiveSummary;
  /** Already signed out on at least one node. */
  revoked: boolean;
  /** At least one node didn't answer. The live list may be short. */
  incomplete: boolean;
  /** No node answered: nothing to show, so don't offer the revoke yet. */
  failed: boolean;
}

export function mergePreviews(answers: NodeAnswer<Preview>[]): MergedPreview {
  const ok = answers.filter((a): a is Extract<NodeAnswer<Preview>, { ok: true }> => a.ok);
  const seen = new Map<string, "checkouts" | "helpRequests" | "other">();
  let heldMax = 0;
  for (const a of ok) {
    let held = 0;
    for (const item of a.value.live) {
      if (item.kind === "checkout" && item.id) seen.set(`c:${item.id}`, "checkouts");
      else if (item.kind === "help_request" && item.id) seen.set(`h:${item.id}`, "helpRequests");
      // `held` and any kind the portal doesn't know: counted, never named.
      // Held items carry no id, so take the largest count any node reports.
      else held++;
    }
    heldMax = Math.max(heldMax, held);
  }
  const live: LiveSummary = { checkouts: 0, helpRequests: 0, other: heldMax };
  for (const k of seen.values()) live[k]++;
  return {
    live,
    revoked: ok.some((a) => a.value.revoked),
    incomplete: ok.length < answers.length,
    failed: ok.length === 0,
  };
}

export interface RevokeOutcome {
  /** done: every node answered; partial: at least one did; failed: none did. */
  status: "done" | "partial" | "failed";
  /** The strongest mode any node applied. */
  mode: RevokeMode | null;
  upgraded: boolean;
  missingNodes: string[];
}

const stronger = (a: RevokeMode | null, b: RevokeMode | null): RevokeMode | null =>
  a === "full" || b === "full" ? "full" : (a ?? b);

export function summarizeRevoke(answers: NodeAnswer<RevokeAnswer>[]): RevokeOutcome {
  let mode: RevokeMode | null = null;
  let upgraded = false;
  const missingNodes: string[] = [];
  for (const a of answers) {
    if (!a.ok) {
      missingNodes.push(a.node);
      continue;
    }
    mode = stronger(mode, a.value.mode);
    upgraded ||= a.value.upgraded;
  }
  const status = missingNodes.length === 0 ? "done" : missingNodes.length < answers.length ? "partial" : "failed";
  return { status, mode, upgraded, missingNodes };
}

export interface RevokeOthersOutcome extends RevokeOutcome {
  /** Distinct phones newly or already signed out across the nodes. */
  devices: number;
  /** A node refused because it doesn't know the phone to keep (yet), or it's revoked. */
  keepRefused: boolean;
}

export function summarizeRevokeOthers(answers: NodeAnswer<RevokeOthersAnswer>[]): RevokeOthersOutcome {
  let mode: RevokeMode | null = null;
  let upgraded = false;
  const devices = new Set<string>();
  const missingNodes: string[] = [];
  let keepRefused = false;
  for (const a of answers) {
    if (!a.ok) {
      missingNodes.push(a.node);
      keepRefused ||= a.code === "keep_device_revoked" || a.code === "device_not_found";
      continue;
    }
    for (const d of a.value.revoked) {
      devices.add(d.deviceId);
      mode = stronger(mode, d.mode);
      upgraded ||= d.upgraded;
    }
  }
  const status = missingNodes.length === 0 ? "done" : missingNodes.length < answers.length ? "partial" : "failed";
  return { status, mode, upgraded, missingNodes, devices: devices.size, keepRefused };
}

export interface MergedDevices {
  devices: LinkedDevice[];
  /** At least one node didn't answer: a phone known only there is missing. */
  incomplete: boolean;
  /** No node answered: there is no list, which is not the same as no phones. */
  failed: boolean;
}

/** One list from every node's. A phone is revoked if ANY node says so, with
 *  the earliest revoke time and the strongest mode (rev 1.1 §3.6, rev 2). */
export function mergeDeviceLists(answers: NodeAnswer<LinkedDevice[]>[]): MergedDevices {
  const byId = new Map<string, LinkedDevice>();
  let answered = 0;
  for (const a of answers) {
    if (!a.ok) continue;
    answered++;
    for (const d of a.value) {
      const prev = byId.get(d.deviceId);
      if (!prev) {
        byId.set(d.deviceId, { ...d });
        continue;
      }
      const revokedAt =
        prev.userRevokedAt && d.userRevokedAt
          ? prev.userRevokedAt < d.userRevokedAt ? prev.userRevokedAt : d.userRevokedAt
          : (prev.userRevokedAt ?? d.userRevokedAt ?? null);
      byId.set(d.deviceId, {
        ...prev,
        lastSeenAt: prev.lastSeenAt > d.lastSeenAt ? prev.lastSeenAt : d.lastSeenAt,
        userRevokedAt: revokedAt,
        revokeReason: prev.revokeReason ?? d.revokeReason ?? null,
        revokeMode: stronger(prev.revokeMode ?? null, d.revokeMode ?? null),
      });
    }
  }
  const devices = [...byId.values()].sort((x, y) => (y.lastSeenAt > x.lastSeenAt ? 1 : -1));
  return { devices, incomplete: answered < answers.length, failed: answered === 0 };
}
