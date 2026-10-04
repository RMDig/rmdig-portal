import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// The portal channel: AvServ → portal SAR intake (AvServ
// sar_portal_intake.md). Pure parts, unit-tested: key parsing, signature
// verification, the payload schema, and grouping both nodes' deliveries of
// one alert. The route (app/api/sar/intake) wires them to the request.

export const MAX_SKEW_SECONDS = 300;

/** "keyId:secret,keyId:secret" → Map. A malformed entry is a config error
 *  and throws, so a typo can't silently drop a node's key. */
export function parseIntakeKeys(packed: string | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  if (!packed) return keys;
  for (const entry of packed.split(",").map((e) => e.trim()).filter(Boolean)) {
    const i = entry.indexOf(":");
    const id = entry.slice(0, i).trim();
    const secret = entry.slice(i + 1).trim();
    if (i <= 0 || !id || secret.length < 32) {
      throw new Error("AVSERV_SAR_INTAKE_KEYS: each entry must be keyId:secret with a secret of 32+ characters");
    }
    keys.set(id, secret);
  }
  return keys;
}

export type SignatureCheck = { ok: true } | { ok: false; code: "unknown_key" | "bad_signature" | "stale_signature" };

/** Verify `X-AvAI-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256(secret, t + "." + rawBody). */
export function verifySignature(input: {
  keys: Map<string, string>;
  keyId: string | null;
  header: string | null;
  rawBody: Buffer;
  nowSeconds: number;
}): SignatureCheck {
  const secret = input.keyId ? input.keys.get(input.keyId) : undefined;
  if (!secret) return { ok: false, code: "unknown_key" };
  const parts = Object.fromEntries(
    (input.header ?? "").split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/i.test(v1)) return { ok: false, code: "bad_signature" };
  if (Math.abs(input.nowSeconds - t) > MAX_SKEW_SECONDS) return { ok: false, code: "stale_signature" };
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(`${t}.`, "utf8"), input.rawBody]))
    .digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected) ? { ok: true } : { ok: false, code: "bad_signature" };
}

const Fix = z.object({ lat: z.number(), lon: z.number(), accuracyMeters: z.number().nullable(), at: z.string() }).nullable();

const Envelope = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().min(1).max(200),
  alertId: z.string().min(1).max(300),
  teamId: z.string().uuid(),
  capability: z.enum(["checkout_alerts", "send_help_added", "send_help_area"]).nullable().optional(),
  node: z.string().min(1).max(100),
  sentAt: z.string(),
  drill: z.boolean(),
});

export const IntakePayload = z.discriminatedUnion("kind", [
  Envelope.extend({
    kind: z.literal("overdue"),
    alert: z.object({
      checkoutId: z.string(),
      userDisplayName: z.string(),
      lastFix: Fix,
      plannedRoute: z.unknown().nullable(),
      expectedReturnAt: z.string(),
      alertedAt: z.string(),
    }),
  }),
  Envelope.extend({
    kind: z.literal("send_help"),
    alert: z.object({
      helpRequestId: z.string(),
      userDisplayName: z.string(),
      lastFix: Fix,
      note: z.string().nullable(),
      checkoutId: z.string().nullable(),
      openedAt: z.string(),
    }),
  }),
  Envelope.extend({ kind: z.literal("all_clear"), alert: z.object({ refersTo: z.string(), at: z.string() }) }),
  Envelope.extend({ kind: z.literal("disregard"), alert: z.object({ refersTo: z.string(), at: z.string() }) }),
  Envelope.extend({
    kind: z.literal("duplicate_disclaimer"),
    alert: z.object({ refersTo: z.string(), deliveries: z.number() }),
  }),
]);
export type IntakePayload = z.infer<typeof IntakePayload>;

export interface StoredMessage {
  messageId: string;
  alertId: string;
  kind: string;
  node: string;
  drill: boolean;
  receivedAt: Date;
  payload: IntakePayload;
}

export interface TeamAlert {
  alertId: string;
  kind: "overdue" | "send_help";
  /** open until an all-clear (resolved) or a retraction (retracted). */
  state: "open" | "resolved" | "retracted";
  userDisplayName: string;
  lastFix: z.infer<typeof Fix>;
  expectedReturnAt: string | null;
  note: string | null;
  firstReceivedAt: Date;
  /** Distinct deliveries of the alert itself, one per node per message. */
  deliveries: Array<{ node: string; messageId: string; receivedAt: Date }>;
  drill: boolean;
  resolvedAt: string | null;
}

/** Group messages into alerts: both nodes' deliveries of one alert are one
 *  alert with two deliveries, never two alerts (contract §4). An all-clear
 *  or a retraction from any node closes it. */
export function groupAlerts(messages: StoredMessage[]): TeamAlert[] {
  const byAlert = new Map<string, StoredMessage[]>();
  for (const m of messages) {
    const key = m.payload.kind === "overdue" || m.payload.kind === "send_help" ? m.alertId : m.payload.alert.refersTo;
    byAlert.set(key, [...(byAlert.get(key) ?? []), m]);
  }
  const alerts: TeamAlert[] = [];
  for (const [alertId, msgs] of byAlert) {
    const primary = msgs
      .filter((m) => m.payload.kind === "overdue" || m.payload.kind === "send_help")
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const first = primary[0];
    if (!first) continue; // a follow-up whose alert hasn't arrived yet
    const latest = primary[primary.length - 1]!;
    const p = latest.payload as Extract<IntakePayload, { kind: "overdue" | "send_help" }>;
    const close = msgs.find((m) => m.payload.kind === "all_clear" || m.payload.kind === "disregard");
    alerts.push({
      alertId,
      kind: p.kind,
      state: !close ? "open" : close.payload.kind === "all_clear" ? "resolved" : "retracted",
      userDisplayName: p.alert.userDisplayName,
      lastFix: p.alert.lastFix,
      expectedReturnAt: p.kind === "overdue" ? p.alert.expectedReturnAt : null,
      note: p.kind === "send_help" ? p.alert.note : null,
      firstReceivedAt: first.receivedAt,
      deliveries: primary.map((m) => ({ node: m.node, messageId: m.messageId, receivedAt: m.receivedAt })),
      drill: primary.some((m) => m.drill),
      resolvedAt: close && "at" in close.payload.alert ? close.payload.alert.at : null,
    });
  }
  // Open first, newest first.
  return alerts.sort((a, b) =>
    a.state === b.state ? b.firstReceivedAt.getTime() - a.firstReceivedAt.getTime() : a.state === "open" ? -1 : 1,
  );
}
