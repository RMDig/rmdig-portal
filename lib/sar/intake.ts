import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// The portal channel: AvServ → portal SAR intake (AvServ
// sar_portal_intake.md). Pure parts, unit-tested: key parsing, signature
// verification, the payload schema, and grouping both nodes' deliveries of
// one alert. The route (app/api/sar/intake) wires them to the request.

export const MAX_SKEW_SECONDS = 300;

export interface IntakeKey {
  secret: string;
  /** The node that signs with this key, as it sends X-AvAI-Node. */
  node: string;
}

/** "keyId:secret,…" (AVSERV_SAR_INTAKE_KEYS, secret) and "keyId:node,…"
 *  (AVSERV_SAR_INTAKE_KEY_NODES, not secret) → Map. Each key belongs to one
 *  node (AvServ, 2026-11-11): AvServ sends whatever key id its operator set,
 *  so the binding is explicit, never parsed from the name. A malformed entry,
 *  a key with no node, or a node binding for no key is a config error and
 *  throws, so a typo can't leave a key any node may sign with. */
export function parseIntakeKeys(packed: string | undefined, nodes: string | undefined): Map<string, IntakeKey> {
  const keys = new Map<string, IntakeKey>();
  if (!packed) return keys;
  const pairs = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => {
        const i = e.indexOf(":");
        return { id: i > 0 ? e.slice(0, i).trim() : "", value: i > 0 ? e.slice(i + 1).trim() : "" };
      });
  const nodeOf = new Map<string, string>();
  for (const { id, value } of pairs(nodes)) {
    if (!id || !value || value.includes(":")) throw new Error("AVSERV_SAR_INTAKE_KEY_NODES: each entry must be keyId:node");
    nodeOf.set(id, value);
  }
  for (const { id, value: secret } of pairs(packed)) {
    if (!id || secret.length < 32) {
      throw new Error("AVSERV_SAR_INTAKE_KEYS: each entry must be keyId:secret with a secret of 32+ characters");
    }
    const node = nodeOf.get(id);
    if (!node) throw new Error(`AVSERV_SAR_INTAKE_KEY_NODES: key ${id} has no node`);
    keys.set(id, { secret, node });
  }
  for (const id of nodeOf.keys()) {
    if (!keys.has(id)) throw new Error(`AVSERV_SAR_INTAKE_KEY_NODES: ${id} names no key in AVSERV_SAR_INTAKE_KEYS`);
  }
  return keys;
}

export type IntakeKeyCheck = { status: "ok"; keys: number } | { status: "skipped" } | { status: "error"; error: string };

/** For the production build (scripts/check-service-key.ts): with intake
 *  configured, every key must load and name its node, or intake would refuse
 *  every alert (503). */
export function checkIntakeKeyConfig(e: { AVSERV_SAR_INTAKE_KEYS?: string; AVSERV_SAR_INTAKE_KEY_NODES?: string }): IntakeKeyCheck {
  if (!e.AVSERV_SAR_INTAKE_KEYS) return { status: "skipped" };
  try {
    return { status: "ok", keys: parseIntakeKeys(e.AVSERV_SAR_INTAKE_KEYS, e.AVSERV_SAR_INTAKE_KEY_NODES).size };
  } catch (err) {
    return { status: "error", error: (err as Error).message };
  }
}

export type SignatureCheck = { ok: true } | { ok: false; code: "unknown_key" | "bad_signature" | "stale_signature" };

/** Verify `X-AvAI-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256(secret, t + "." + rawBody),
 *  with a key that belongs to the node named in X-AvAI-Node: another node's
 *  key is refused as unknown (AvServ, 2026-11-11). */
export function verifySignature(input: {
  keys: Map<string, IntakeKey>;
  keyId: string | null;
  node: string | null;
  header: string | null;
  rawBody: Buffer;
  nowSeconds: number;
}): SignatureCheck {
  const key = input.keyId ? input.keys.get(input.keyId) : undefined;
  if (!key || key.node !== input.node) return { ok: false, code: "unknown_key" };
  const secret = key.secret;
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

// The fields that identify and route a message are essential: a message
// without them is refused. Every detail of the alert is nullable, and
// parseIntakePayload drops a malformed one rather than refuse the alert: a
// missing fix time from an older app build must never cost a team the alert
// (found in the 2026-10-06 drill). AvServ always sends lastFix as
// {lat, lon, accuracyMeters, at}, with null for an unknown accuracy or time.
// Unknown accuracy or time (null, or a build that left the key out) keeps the
// fix: only a fix without lat/lon is dropped.
const unknownAsNull = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v) => v ?? null);
const Fix = z
  .object({ lat: z.number(), lon: z.number(), accuracyMeters: unknownAsNull(z.number()), at: unknownAsNull(z.string()) })
  .nullable();

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

const detail = z.string().nullable();
// A blank name is an unknown name (a device that never set one).
const userName = z
  .string()
  .nullable()
  .transform((v) => (v && v.trim() ? v : null));

export const IntakePayload = z.discriminatedUnion("kind", [
  Envelope.extend({
    kind: z.literal("overdue"),
    alert: z.object({
      checkoutId: detail,
      userDisplayName: userName,
      lastFix: Fix,
      plannedRoute: z.unknown().nullable(),
      expectedReturnAt: detail,
      alertedAt: detail,
    }),
  }),
  Envelope.extend({
    kind: z.literal("send_help"),
    alert: z.object({
      helpRequestId: detail,
      userDisplayName: userName,
      lastFix: Fix,
      note: detail,
      checkoutId: detail,
      openedAt: detail,
    }),
  }),
  Envelope.extend({ kind: z.literal("all_clear"), alert: z.object({ refersTo: z.string(), at: detail }) }),
  Envelope.extend({ kind: z.literal("disregard"), alert: z.object({ refersTo: z.string(), at: detail }) }),
  Envelope.extend({
    kind: z.literal("duplicate_disclaimer"),
    alert: z.object({ refersTo: z.string(), deliveries: z.number().nullable() }),
  }),
  // A team's test message (AvServ sar_test_alert.md §4; G2 item 3): never an
  // alert. It names no user and no place, carries no capability, and its
  // alertId is "test:<testId>", so it can't group with a real alert.
  Envelope.extend({
    kind: z.literal("test"),
    capability: z.null(),
    alert: z.object({ testId: z.string().min(1).max(200) }),
  }),
]);
export type IntakePayload = z.infer<typeof IntakePayload>;

/** How an alert names its user: the name, or "A user" when it's unknown or
 *  blank (including alerts stored before blank names were normalized). */
export function alertUserName(name: string | null | undefined): string {
  return name && name.trim() ? name : "A user";
}

/** Alert details that can be dropped (set to null) instead of refusing the
 *  alert. Everything else is essential. */
const DROPPABLE = new Set(["checkoutId", "userDisplayName", "lastFix", "plannedRoute", "expectedReturnAt", "alertedAt", "helpRequestId", "note", "openedAt", "at", "deliveries"]);

export type ParsedIntake = { ok: true; payload: IntakePayload; dropped: string[] } | { ok: false; error: string };

/** Parse a delivery. A missing or malformed alert detail is set to null and
 *  named in `dropped` (the caller logs it loudly); only an essential field
 *  refuses the message. */
export function parseIntakePayload(raw: unknown): ParsedIntake {
  const dropped: string[] = [];
  let candidate = raw;
  for (let attempt = 0; attempt < DROPPABLE.size + 1; attempt++) {
    const r = IntakePayload.safeParse(candidate);
    if (r.success && r.data.kind === "test" && r.data.alertId !== `test:${r.data.alert.testId}`) {
      return { ok: false, error: "alertId: a test's alertId must be test:<testId>" };
    }
    if (r.success) return { ok: true, payload: r.data, dropped };
    const fixable = r.error.issues.map((i) => i.path).filter((path) => path[0] === "alert" && typeof path[1] === "string" && DROPPABLE.has(path[1]));
    const essential = r.error.issues.find((i) => !(i.path[0] === "alert" && typeof i.path[1] === "string" && DROPPABLE.has(i.path[1])));
    if (essential || fixable.length === 0 || typeof candidate !== "object" || candidate === null) {
      const issue = essential ?? r.error.issues[0];
      return { ok: false, error: `${issue?.path.join(".") || "payload"}: ${issue?.message ?? "invalid"}` };
    }
    const alert = { ...((candidate as { alert?: Record<string, unknown> }).alert ?? {}) };
    for (const path of fixable) {
      const field = path[1] as string;
      if (alert[field] !== null) {
        alert[field] = null;
        if (!dropped.includes(field)) dropped.push(field);
      }
    }
    candidate = { ...(candidate as object), alert };
  }
  return { ok: false, error: "payload: could not be repaired" };
}

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
  userDisplayName: string | null;
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
    // A test is never an alert (sar_test_alert.md): the checklist shows it.
    if (m.payload.kind === "test") continue;
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
