import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { groupAlerts, IntakePayload, parseIntakeKeys, verifySignature, type StoredMessage } from "@/lib/sar/intake";

// AvServ sar_portal_intake.md: keys, signatures, payloads, and one alert per
// alertId however many nodes delivered it.

const SECRET = "s".repeat(64);
const keys = parseIntakeKeys(`sarintake-avserv-2-1:${SECRET},sarintake-avserv-3-1:${"t".repeat(64)}`);
const sign = (t: number, body: string, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("parseIntakeKeys", () => {
  it("parses packed keys, and none when unset", () => {
    expect([...keys.keys()]).toEqual(["sarintake-avserv-2-1", "sarintake-avserv-3-1"]);
    expect(parseIntakeKeys(undefined).size).toBe(0);
  });
  it("throws on a malformed entry or a short secret", () => {
    expect(() => parseIntakeKeys("nocolon")).toThrow();
    expect(() => parseIntakeKeys("k:short")).toThrow();
  });
});

describe("verifySignature", () => {
  const body = '{"x":1}';
  const now = 1_790_000_000;
  const check = (o: Partial<Parameters<typeof verifySignature>[0]>) =>
    verifySignature({ keys, keyId: "sarintake-avserv-2-1", header: sign(now, body), rawBody: Buffer.from(body), nowSeconds: now, ...o });

  it("accepts a valid signature within the window", () => {
    expect(check({})).toEqual({ ok: true });
    expect(check({ nowSeconds: now + 300 })).toEqual({ ok: true });
  });
  it("rejects an unknown key, a stale timestamp, a tampered body and the wrong secret", () => {
    expect(check({ keyId: "nope" })).toEqual({ ok: false, code: "unknown_key" });
    expect(check({ nowSeconds: now + 301 })).toEqual({ ok: false, code: "stale_signature" });
    expect(check({ rawBody: Buffer.from('{"x":2}') })).toEqual({ ok: false, code: "bad_signature" });
    expect(check({ keyId: "sarintake-avserv-3-1" })).toEqual({ ok: false, code: "bad_signature" });
    expect(check({ header: "garbage" })).toEqual({ ok: false, code: "bad_signature" });
  });
});

const env = { schemaVersion: 1, teamId: "11111111-1111-4111-8111-111111111111", capability: "checkout_alerts", sentAt: "2026-10-04T10:00:00Z", drill: false };
const overdue = (messageId: string, node: string) => ({
  ...env,
  messageId,
  node,
  alertId: "sub-1:team",
  kind: "overdue",
  alert: { checkoutId: "c1", userDisplayName: "Pat", lastFix: { lat: 39.6, lon: -106.1, accuracyMeters: 30, at: "2026-10-04T09:00:00Z" }, plannedRoute: null, expectedReturnAt: "2026-10-04T09:30:00Z", alertedAt: "2026-10-04T10:00:00Z" },
});

describe("IntakePayload", () => {
  it("accepts each kind and rejects unknown kinds or a wrong schema version", () => {
    expect(IntakePayload.safeParse(overdue("m1", "avserv-2")).success).toBe(true);
    expect(IntakePayload.safeParse({ ...env, messageId: "m", node: "n", alertId: "a", kind: "all_clear", alert: { refersTo: "a", at: "x" } }).success).toBe(true);
    expect(IntakePayload.safeParse({ ...overdue("m1", "n"), kind: "incident" }).success).toBe(false);
    expect(IntakePayload.safeParse({ ...overdue("m1", "n"), schemaVersion: 2 }).success).toBe(false);
  });
});

describe("groupAlerts", () => {
  const msg = (p: object, receivedAt: string): StoredMessage => {
    const payload = IntakePayload.parse(p);
    return { messageId: payload.messageId, alertId: payload.alertId, kind: payload.kind, node: payload.node, drill: payload.drill, receivedAt: new Date(receivedAt), payload };
  };

  it("shows both nodes' deliveries as one open alert", () => {
    const alerts = groupAlerts([msg(overdue("m1", "avserv-2"), "2026-10-04T10:00:01Z"), msg(overdue("m2", "avserv-3"), "2026-10-04T10:00:03Z")]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alertId: "sub-1:team", kind: "overdue", state: "open", userDisplayName: "Pat" });
    expect(alerts[0]!.deliveries.map((d) => d.node)).toEqual(["avserv-2", "avserv-3"]);
  });

  it("closes an alert on an all-clear or a retraction from any node", () => {
    const resolved = groupAlerts([
      msg(overdue("m1", "avserv-2"), "2026-10-04T10:00:01Z"),
      msg({ ...env, messageId: "m3", node: "avserv-3", alertId: "sub-1:team", kind: "all_clear", alert: { refersTo: "sub-1:team", at: "2026-10-04T10:20:00Z" } }, "2026-10-04T10:20:01Z"),
    ]);
    expect(resolved[0]).toMatchObject({ state: "resolved", resolvedAt: "2026-10-04T10:20:00Z" });
  });

  it("waits for the alert itself before showing a follow-up, and lists open alerts first", () => {
    expect(groupAlerts([msg({ ...env, messageId: "m9", node: "n", alertId: "x", kind: "disregard", alert: { refersTo: "x", at: "t" } }, "2026-10-04T10:00:00Z")])).toEqual([]);
    const two = groupAlerts([
      msg({ ...overdue("a", "n"), alertId: "old" }, "2026-10-01T10:00:00Z"),
      msg({ ...env, messageId: "c", node: "n", alertId: "old", kind: "all_clear", alert: { refersTo: "old", at: "t" } }, "2026-10-01T11:00:00Z"),
      msg({ ...overdue("b", "n"), alertId: "new" }, "2026-10-02T10:00:00Z"),
    ]);
    expect(two.map((a) => [a.alertId, a.state])).toEqual([["new", "open"], ["old", "resolved"]]);
  });
});
