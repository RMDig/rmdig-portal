import * as Sentry from "@sentry/nextjs";
import type { z } from "zod";

import { env } from "../env";
import { logger } from "../logger";
import { ListDevicesResponseSchema, type LinkedDevice } from "./client";
import { mergeDeviceLists, type MergedDevices } from "./device-revoke-merge";
import { mockDeviceList, mockPreview, mockResetCode, mockRevoke, mockRevokeOthers } from "./device-revoke-mock";
import {
  PreviewSchema,
  ResetCodeSchema,
  RevokeOthersSchema,
  RevokeSchema,
  type AuthStrength,
  type NodeAnswer,
  type Preview,
  type ResetCode,
  type RevokeAnswer,
  type RevokeOthersAnswer,
  type RevokeReason,
} from "./device-revoke-types";
import { AvServError, avservFetch, contractFailure, failureCode, isMock } from "./request";
import { avservNodes } from "./sar-teams";
import { deviceAdminKeyConfigured, type KeyRole } from "./service-jwt";

// AvServ's device revoke (docs/contracts/device_revoke.md rev 2). Every call
// goes to EVERY node, and each node's answer is returned for the caller to
// merge (lib/avserv/device-revoke-merge.ts): one success reaches the other
// node by replication, and a repeat is always safe. The revoke routes sign
// with the device-admin key only (plan 36 S3).

/** Whether signing a phone out can work here: the mock, or a real AvServ with
 *  the device-admin key configured. */
export function deviceRevokeAvailable(): boolean {
  const base = env.AVSERV_BASE_URL;
  return !!base && (isMock(base) || deviceAdminKeyConfigured());
}

function mockMode(): boolean {
  const base = env.AVSERV_BASE_URL;
  return !!base && isMock(base);
}

async function everyNode<T>(
  path: string,
  init: { method: string; body?: unknown },
  schema: z.ZodType<T>,
  keyRole: KeyRole,
  readerUserId: string | null,
): Promise<NodeAnswer<T>[]> {
  const headers: Record<string, string> = {};
  if (readerUserId) headers["x-avai-reader"] = `portal-user:${readerUserId}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return Promise.all(
    avservNodes().map(async ({ name, baseUrl }): Promise<NodeAnswer<T>> => {
      try {
        const res = await avservFetch(
          baseUrl,
          path,
          { method: init.method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
          keyRole,
        );
        if (!res.ok) {
          const err = await contractFailure(res, false);
          return { node: name, ok: false, status: err.status, code: err.code };
        }
        const parsed = schema.safeParse(await res.json().catch(() => null));
        if (!parsed.success) {
          // A drifted contract is our bug to fix, not an outage: loud.
          logger.error({ event: "avserv.device_revoke.bad_response", node: name, path });
          Sentry.captureMessage("AvServ device_revoke response failed schema validation", {
            level: "error",
            tags: { event: "avserv.device_revoke.bad_response" },
          });
          return { node: name, ok: false, status: res.status, code: "bad_response" };
        }
        return { node: name, ok: true, value: parsed.data };
      } catch (err) {
        return { node: name, ok: false, code: failureCode(err, { node: name, path }) };
      }
    }),
  );
}

const devicePath = (accountId: string, deviceId: string) =>
  `/v1/internal/accounts/${encodeURIComponent(accountId)}/devices/${encodeURIComponent(deviceId)}`;

export async function revokePreview(accountId: string, deviceId: string, readerUserId: string) {
  if (mockMode()) return [mockPreview(accountId, deviceId)];
  return everyNode<Preview>(`${devicePath(accountId, deviceId)}/revoke-preview`, { method: "GET" }, PreviewSchema, "device_admin", readerUserId);
}

export async function revokeDevice(
  accountId: string,
  deviceId: string,
  body: { reason: RevokeReason; authStrength: AuthStrength },
  readerUserId: string,
): Promise<NodeAnswer<RevokeAnswer>[]> {
  if (mockMode()) return [mockRevoke(accountId, deviceId, body)];
  return everyNode<RevokeAnswer>(`${devicePath(accountId, deviceId)}/revoke`, { method: "POST", body }, RevokeSchema, "device_admin", readerUserId);
}

export async function revokeOtherDevices(
  accountId: string,
  body: { keepDeviceId: string | null; reason: RevokeReason; authStrength: AuthStrength },
  readerUserId: string,
): Promise<NodeAnswer<RevokeOthersAnswer>[]> {
  if (mockMode()) return [mockRevokeOthers(accountId, body)];
  return everyNode<RevokeOthersAnswer>(
    `/v1/internal/accounts/${encodeURIComponent(accountId)}/devices/revoke-others`,
    { method: "POST", body },
    RevokeOthersSchema,
    "device_admin",
    readerUserId,
  );
}

/** The account's phones from every node, merged: revoked if any node says so
 *  (rev 1.1 §3.6). Read with the everyday key (group `accounts`). */
export async function listDevicesEveryNode(accountId: string): Promise<MergedDevices> {
  if (mockMode()) return { devices: mockDeviceList(accountId), incomplete: false, failed: false };
  const answers = await everyNode<{ devices: LinkedDevice[] }>(
    `/v1/internal/accounts/${encodeURIComponent(accountId)}/devices`,
    { method: "GET" },
    ListDevicesResponseSchema,
    "default",
    null,
  );
  const merged = mergeDeviceLists(answers.map((a) => (a.ok ? { ...a, value: a.value.devices } : a)));
  if (merged.failed) {
    // No list at all: the page's "couldn't load" state, never "no phones".
    throw new AvServError("No AvServ node answered the device list", undefined, "unreachable");
  }
  return merged;
}

export type ResetCodeAnswer = NodeAnswer<ResetCode> & { retryAfterSec?: number };

/** An App Lock reset code (§3.5). ONE node, and the other only when nothing
 *  arrived or it answered 503: two codes for one phone are harmless (each is
 *  single use and only starts the wait), but there's no reason to make two. */
export async function mintAppLockResetCode(accountId: string, deviceId: string, readerUserId: string): Promise<ResetCodeAnswer> {
  if (mockMode()) return mockResetCode(accountId, deviceId);
  const path = `${devicePath(accountId, deviceId)}/app-lock-reset-codes`;
  let last: ResetCodeAnswer | null = null;
  for (const { name, baseUrl } of avservNodes()) {
    try {
      const res = await avservFetch(
        baseUrl,
        path,
        { method: "POST", headers: { "x-avai-reader": `portal-user:${readerUserId}` } },
        "device_admin",
      );
      if (res.ok) {
        const parsed = ResetCodeSchema.safeParse(await res.json().catch(() => null));
        if (parsed.success) return { node: name, ok: true, value: parsed.data };
        logger.error({ event: "avserv.device_revoke.bad_response", node: name, path });
        Sentry.captureMessage("AvServ app-lock-reset-codes response failed schema validation", {
          level: "error",
          tags: { event: "avserv.device_revoke.bad_response" },
        });
        return { node: name, ok: false, status: res.status, code: "bad_response" };
      }
      const retry = Number(res.headers.get("retry-after"));
      const err = await contractFailure(res, false);
      last = { node: name, ok: false, status: err.status, code: err.code, ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSec: retry } : {}) };
      if (res.status !== 503) return last;
    } catch (err) {
      last = { node: name, ok: false, code: failureCode(err, { node: name, path }) };
      if (last.code !== "unreachable") return last;
    }
  }
  return last ?? { node: "none", ok: false, code: "no_nodes" };
}
