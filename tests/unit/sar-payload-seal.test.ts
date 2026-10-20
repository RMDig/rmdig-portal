import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { parsePackedKeys } from "@/lib/crypto/keyed-aes";
import { checkSarPayloadKeyConfig, openPayload, parseSarPayloadKeys, sealPayload } from "@/lib/sar/payload-seal";
import type { IntakePayload } from "@/lib/sar/intake";

// Plan 36 H4: an alert's position, route and note are sealed in the stored
// payload; everything that routes or groups a message stays plain.

const hex = () => randomBytes(32).toString("hex");
const k1 = hex();
const keys = parseSarPayloadKeys(`s1:${k1}`);

const envelope = {
  schemaVersion: 1 as const,
  messageId: "m1",
  alertId: "sub:team",
  teamId: "11111111-1111-4111-8111-111111111111",
  capability: "checkout_alerts" as const,
  node: "avserv-2",
  sentAt: "2026-10-20T10:00:00Z",
  drill: false,
};
const fix = { lat: 39.61234, lon: -106.05678, accuracyMeters: 12, at: "2026-10-20T09:55:00Z" };
const route = { type: "MultiLineString", coordinates: [[[-106.06, 39.47], [-106.02, 39.5]]] };
const overdue: IntakePayload = {
  ...envelope,
  kind: "overdue",
  alert: { checkoutId: "c1", userDisplayName: "Pat", lastFix: fix, plannedRoute: route, expectedReturnAt: "2026-10-20T09:00:00Z", alertedAt: "2026-10-20T10:00:00Z" },
};
const sendHelp: IntakePayload = {
  ...envelope,
  kind: "send_help",
  alert: { helpRequestId: "h1", userDisplayName: "Pat", lastFix: fix, note: "Twisted ankle below the ridge", checkoutId: null, openedAt: "2026-10-20T10:00:00Z" },
};

describe("sealPayload / openPayload", () => {
  it("seals an overdue alert's fix and route, and opens them back exactly", () => {
    const stored = sealPayload(keys, overdue) as { alert: Record<string, unknown> };
    expect(stored.alert.lastFix).toMatch(/^v1:s1:/);
    expect(stored.alert.plannedRoute).toMatch(/^v1:s1:/);
    expect(openPayload(() => keys, stored)).toEqual(overdue);
  });

  it("seals a Send Help alert's fix and note", () => {
    const stored = sealPayload(keys, sendHelp) as { alert: Record<string, unknown> };
    expect(stored.alert.note).toMatch(/^v1:s1:/);
    expect(openPayload(() => keys, stored)).toEqual(sendHelp);
  });

  it("leaves no position or note in the stored JSON, and keeps routing fields plain", () => {
    const json = JSON.stringify([sealPayload(keys, overdue), sealPayload(keys, sendHelp)]);
    expect(json).not.toMatch(/39\.61|106\.05|ankle|MultiLineString/);
    expect(json).toContain('"alertId":"sub:team"');
    expect(json).toContain('"userDisplayName":"Pat"');
    expect(json).toContain('"expectedReturnAt":"2026-10-20T09:00:00Z"');
  });

  it("keeps null details null", () => {
    const bare: IntakePayload = { ...overdue, alert: { ...overdue.alert, lastFix: null, plannedRoute: null } };
    expect(sealPayload(keys, bare)).toEqual(bare);
  });

  it("stores follow-ups unchanged", () => {
    const clear: IntakePayload = { ...envelope, kind: "all_clear", alert: { refersTo: "sub:team", at: null } };
    expect(sealPayload(keys, clear)).toBe(clear);
    expect(openPayload(() => keys, clear)).toBe(clear);
  });

  it("passes plain rows (stored before sealing, or the preview demo) through without needing a key", () => {
    const noKeys = vi.fn(() => {
      throw new Error("no keys");
    });
    expect(openPayload(noKeys, overdue)).toEqual(overdue);
    expect(noKeys).not.toHaveBeenCalled();
  });

  it("opens values sealed under an older key after rotation, and fails loudly without it", () => {
    const stored = sealPayload(keys, overdue);
    const rotated = parseSarPayloadKeys(`s2:${hex()},s1:${k1}`);
    expect((sealPayload(rotated, overdue) as { alert: { lastFix: string } }).alert.lastFix).toMatch(/^v1:s2:/);
    expect(openPayload(() => rotated, stored)).toEqual(overdue);
    expect(() => openPayload(() => parseSarPayloadKeys(`s2:${hex()}`), stored)).toThrow(/s1 is not configured/);
  });

  it("refuses a tampered value", () => {
    const stored = sealPayload(keys, sendHelp) as { alert: { note: string } };
    const parts = stored.alert.note.split(":");
    const ct = Buffer.from(parts[4]!, "base64");
    ct[0]! ^= 1;
    parts[4] = ct.toString("base64");
    expect(() => openPayload(() => keys, { ...stored, alert: { ...stored.alert, note: parts.join(":") } })).toThrow();
  });
});

describe("SAR_PAYLOAD_KEYS", () => {
  it("must be set and well formed", () => {
    expect(() => parseSarPayloadKeys(undefined)).toThrow(/SAR_PAYLOAD_KEYS is not set/);
    expect(() => parseSarPayloadKeys("s1:abc")).toThrow(/64 hex/);
    expect(() => parsePackedKeys("SAR_PAYLOAD_KEYS", `s1:${k1},s1:${k1}`)).toThrow(/SAR_PAYLOAD_KEYS lists s1 twice/);
  });

  it("fails the production build check only when intake is configured without a usable key", () => {
    expect(checkSarPayloadKeyConfig({})).toEqual({ status: "skipped" });
    expect(checkSarPayloadKeyConfig({ AVSERV_SAR_INTAKE_KEYS: "a:b", SAR_PAYLOAD_KEYS: `s1:${k1}` })).toEqual({ status: "ok", current: "s1" });
    expect(checkSarPayloadKeyConfig({ AVSERV_SAR_INTAKE_KEYS: "a:b" })).toMatchObject({ status: "error", error: expect.stringMatching(/not set/) });
    expect(checkSarPayloadKeyConfig({ AVSERV_SAR_INTAKE_KEYS: "a:b", SAR_PAYLOAD_KEYS: "s1:zz" })).toMatchObject({ status: "error" });
  });
});
