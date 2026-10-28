import * as Sentry from "@sentry/nextjs";
import type { z } from "zod";

import { env } from "../env";
import { logger } from "../logger";
import { mockErase, mockPreview, mockStatus } from "./erasure-mock";
import {
  ErasurePreviewSchema,
  ErasureRecordSchema,
  LiveItemSchema,
  type ErasurePreview,
  type ErasureRecord,
  type NodeResult,
} from "./erasure-types";
import { avservFetch, contractFailure, failureCode, isMock } from "./request";
import { avservNodes } from "./sar-teams";
import { erasureKeyConfigured } from "./service-jwt";

// AvServ account erasure (docs/contracts/account_erasure.md rev 1), for the
// operator's "Erase in AvServ" on the deletion queue. Signed with the erasure
// key only. The preview and status go to EVERY node; the erase goes to ONE
// node (the primary), which replicates it. A POST that gets no answer is
// unknown, not failed: the caller reads status on every node and never
// re-sends to the failover (contract "A timeout is unknown").

/** The erase can outlast the 4 s default: it runs one transaction over every
 *  table holding the account. */
export const ERASE_TIMEOUT_MS = 15_000;

export function erasureAvailable(): boolean {
  const base = env.AVSERV_BASE_URL;
  return !!base && (isMock(base) || erasureKeyConfigured());
}

function mockMode(): boolean {
  const base = env.AVSERV_BASE_URL;
  return !!base && isMock(base);
}

const reader = (userId: string) => `portal-user:${userId}`;
const accountPath = (accountId: string) => `/v1/internal/accounts/${encodeURIComponent(accountId)}`;

async function oneNode<T>(
  node: { name: string; baseUrl: string },
  path: string,
  init: { method: string; body?: unknown; timeoutMs?: number },
  schema: z.ZodType<T>,
  readerUserId: string,
): Promise<NodeResult<T>> {
  const headers: Record<string, string> = { "x-avai-reader": reader(readerUserId) };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  try {
    const res = await avservFetch(
      node.baseUrl,
      path,
      {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        timeoutMs: init.timeoutMs,
      },
      "erasure",
    );
    if (!res.ok) {
      const retry = Number(res.headers.get("retry-after"));
      const retryAfterSec = Number.isFinite(retry) && retry > 0 ? retry : undefined;
      // A blocked erase carries the live items beside the code.
      if (res.status === 409) {
        const body = (await res.clone().json().catch(() => null)) as { live?: unknown } | null;
        const live = LiveItemSchema.array().safeParse(body?.live);
        const err = await contractFailure(res, false);
        return { node: node.name, ok: false, status: 409, code: err.code ?? "http_409", ...(live.success ? { live: live.data } : {}) };
      }
      const err = await contractFailure(res, false);
      return { node: node.name, ok: false, status: err.status, code: err.code ?? `http_${res.status}`, ...(retryAfterSec ? { retryAfterSec } : {}) };
    }
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      // A drifted contract is our bug to fix, not an outage: loud.
      logger.error({ event: "avserv.erasure.bad_response", node: node.name, path });
      Sentry.captureMessage("AvServ erasure response failed schema validation", {
        level: "error",
        tags: { event: "avserv.erasure.bad_response" },
      });
      return { node: node.name, ok: false, status: res.status, code: "bad_response" };
    }
    return { node: node.name, ok: true, value: parsed.data };
  } catch (err) {
    return { node: node.name, ok: false, code: failureCode(err, { call: "erasure", node: node.name, path }) };
  }
}

/** The dry run on every node: erase only when every node says erasable or
 *  already erased (lib/deletion/erasure.ts decides). */
export async function previewErasureEveryNode(accountId: string, readerUserId: string): Promise<NodeResult<ErasurePreview>[]> {
  if (mockMode()) return [{ node: "mock", ok: true, value: mockPreview(accountId) }];
  return Promise.all(
    avservNodes().map((n) => oneNode(n, `${accountPath(accountId)}/erasure-preview`, { method: "GET" }, ErasurePreviewSchema, readerUserId)),
  );
}

/** The erase, on the primary node only. Every value in the body comes from
 *  the deletion_requests row, never from the browser. */
export async function eraseOnPrimary(
  accountId: string,
  body: { requestRef: string; email: string; confirmedAt: string },
  readerUserId: string,
): Promise<NodeResult<ErasureRecord>> {
  if (mockMode()) {
    const r = mockErase(accountId, body, reader(readerUserId));
    return r.ok ? { node: "mock", ok: true, value: r.value } : { node: "mock", ok: false, status: r.status, code: r.code };
  }
  const primary = avservNodes()[0];
  if (!primary) return { node: "none", ok: false, code: "no_nodes" };
  return oneNode(primary, `${accountPath(accountId)}/erasure`, { method: "POST", body, timeoutMs: ERASE_TIMEOUT_MS }, ErasureRecordSchema, readerUserId);
}

/** Each node's erasure record (404 not_erased where it has none yet). */
export async function erasureStatusEveryNode(accountId: string, readerUserId: string): Promise<NodeResult<ErasureRecord>[]> {
  if (mockMode()) {
    const r = mockStatus(accountId);
    return [r ? { node: "mock", ok: true, value: r } : { node: "mock", ok: false, status: 404, code: "not_erased" }];
  }
  return Promise.all(
    avservNodes().map((n) => oneNode(n, `${accountPath(accountId)}/erasure`, { method: "GET" }, ErasureRecordSchema, readerUserId)),
  );
}
