import { createHash } from "node:crypto";

import { mockDevices } from "./client";
import { mockRevokedDevices } from "./device-revoke-mock";
import type { FeedPage } from "./security-events-types";

// In-process stand-in for GET …/security-events (security_events.md rev 1)
// under AVSERV_BASE_URL=mock://*, one node named "mock". Each mock phone was
// registered and linked when it was created, the first added a contact, and
// every mock revoke (device-revoke-mock.ts) appears as a `revoke`. The cursor
// is the index of the next event, oldest first.

const NODE = "mock";

function uuidV5ish(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  const id = hex.slice(0, 12) + "5" + hex.slice(13, 16) + variant + hex.slice(17, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
}

function allEvents(accountId: string): FeedPage["events"] {
  const devices = mockDevices(accountId);
  const events: FeedPage["events"] = [];
  for (const d of devices) {
    events.push({ id: uuidV5ish(`register:${accountId}:${d.deviceId}`), kind: "register", at: d.createdAt, deviceId: d.deviceId });
    events.push({ id: uuidV5ish(`link:${accountId}:${d.deviceId}`), kind: "link", at: d.createdAt, deviceId: d.deviceId });
  }
  const first = devices[0];
  if (first) {
    events.push({ id: uuidV5ish(`contact_add:${accountId}`), kind: "contact_add", at: "2026-05-21T08:00:00Z", deviceId: first.deviceId });
  }
  for (const r of mockRevokedDevices(accountId)) {
    events.push({ id: uuidV5ish(`revoke:${accountId}:${r.deviceId}`), kind: "revoke", at: r.revokedAt, deviceId: r.deviceId });
  }
  return events.sort((a, b) => (a.at < b.at ? -1 : 1));
}

export function mockFeedPage(accountId: string, cursor: string | null, limit: number): FeedPage {
  const events = allEvents(accountId);
  const start = cursor === null ? 0 : Number(cursor);
  const page = events.slice(start, start + limit);
  const next = start + page.length;
  // After a page with events, the cursor points past them; an empty page
  // (nothing newer yet) has none, and the reader keeps its last cursor.
  return { accountId, node: NODE, events: page, nextCursor: page.length > 0 ? String(next) : null };
}

/** The cursor at the end of the mock feed: where notices start when turned on. */
export function mockFeedEnd(accountId: string): string {
  return String(allEvents(accountId).length);
}
