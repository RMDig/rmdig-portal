import { isSealed, open, parsePackedKeys, seal, type KeySet } from "../crypto/keyed-aes";
import type { IntakePayload } from "./intake";

// SAR alert details encrypted at rest (plan 36 H4, owner decision S-D7): an
// alert's last position, planned route and Send Help note are sealed inside
// the stored jsonb with their own keys (SAR_PAYLOAD_KEYS, "kid:hex,kid:hex",
// the first is current), so a database copy alone doesn't show where a user
// was or what they wrote. Everything that routes or groups a message stays
// plain. Retention (lib/sar/retention.ts) still nulls the position fields by
// path, sealed or not. Pure: the key set is passed in.

type Primary = Extract<IntakePayload, { kind: "overdue" | "send_help" }>;
const SEALED_FIELDS = { overdue: ["lastFix", "plannedRoute"], send_help: ["lastFix", "note"] } as const;

/** The key set from SAR_PAYLOAD_KEYS. Throws when it's unset or malformed. */
export function parseSarPayloadKeys(packed: string | undefined): KeySet {
  const { current, keys } = parsePackedKeys("SAR_PAYLOAD_KEYS", packed);
  if (!current) throw new Error("SAR_PAYLOAD_KEYS is not set. Generate a key with `openssl rand -hex 32` (runbook \"Key rotation\").");
  return { current, keys };
}

function fieldsOf(payload: { kind: string }): readonly string[] {
  return payload.kind === "overdue" || payload.kind === "send_help" ? SEALED_FIELDS[payload.kind] : [];
}

/** The payload as stored: each detail field that has a value is sealed. */
export function sealPayload(set: KeySet, payload: IntakePayload): unknown {
  const fields = fieldsOf(payload);
  if (fields.length === 0) return payload;
  const alert: Record<string, unknown> = { ...(payload as Primary).alert };
  for (const f of fields) if (alert[f] !== null && alert[f] !== undefined) alert[f] = seal(set, JSON.stringify(alert[f]));
  return { ...payload, alert };
}

/** A stored payload as the intake parsed it. Rows stored before sealing (the
 *  retention job deletes them within 90 days) and the preview demo's
 *  fictional rows are plain, and pass through; the key set is only needed
 *  once a sealed value turns up. */
export function openPayload(keys: () => KeySet, stored: unknown): IntakePayload {
  const p = stored as IntakePayload;
  const fields = fieldsOf(p);
  if (fields.length === 0) return p;
  const alert: Record<string, unknown> = { ...(p as Primary).alert };
  for (const f of fields) {
    const v = alert[f];
    if (typeof v === "string" && isSealed(v)) alert[f] = JSON.parse(open(keys(), v));
  }
  return { ...p, alert } as IntakePayload;
}

export type SarPayloadKeyCheck = { status: "ok"; current: string } | { status: "skipped" } | { status: "error"; error: string };

/** For the production build (scripts/check-service-key.ts): with intake
 *  configured, the payload keys must load, or every alert would be refused
 *  with a 503. */
export function checkSarPayloadKeyConfig(e: { AVSERV_SAR_INTAKE_KEYS?: string; SAR_PAYLOAD_KEYS?: string }): SarPayloadKeyCheck {
  if (!e.AVSERV_SAR_INTAKE_KEYS) return { status: "skipped" };
  try {
    return { status: "ok", current: parseSarPayloadKeys(e.SAR_PAYLOAD_KEYS).current };
  } catch (err) {
    return { status: "error", error: (err as Error).message };
  }
}
