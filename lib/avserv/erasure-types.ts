import { z } from "zod";

// AvServ account erasure (docs/contracts/account_erasure.md rev 1; plan 47).
// Shapes as AvServ's internal/api/erasure.go and store/erasure.go write them.

export const LiveItemSchema = z.object({
  kind: z.string(), // checkout | help_request | incident | sar_message
  id: z.string(),
});
export type LiveItem = z.infer<typeof LiveItemSchema>;

export const ErasurePreviewSchema = z.object({
  accountId: z.string(),
  node: z.string(),
  alreadyErased: z.boolean(),
  erasable: z.boolean(),
  live: z.array(LiveItemSchema),
});
export type ErasurePreview = z.infer<typeof ErasurePreviewSchema>;

/** The erasure record: POST's answer, and GET …/erasure's. */
export const ErasureRecordSchema = z.object({
  accountId: z.string(),
  alreadyErased: z.boolean(),
  requestRef: z.string(),
  evidence: z.string(),
  originNode: z.string(),
  requestedAt: z.string(),
  appliedAt: z.string(),
  rows: z.record(z.string(), z.number()),
  requestedByKid: z.string().optional(),
  reader: z.string().optional(),
});
export type ErasureRecord = z.infer<typeof ErasureRecordSchema>;

/** One node's answer, or why it has none (code: AvServ's, or unreachable /
 *  bad_response / a portal fault). */
export type NodeResult<T> =
  | { node: string; ok: true; value: T }
  | { node: string; ok: false; status?: number; code: string; live?: LiveItem[]; retryAfterSec?: number };
