import { describe, expect, it, vi } from "vitest";

// Which alert copies an erasure deletes (plan 33 §6.9, F6): AvServ's alert id
// is `<subject>:<teamId>`, built from each dispatch in every node's share log.

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { ShareLogItem } from "@/lib/avserv/share-log";
import { alertKeysFromShareLog, intakeCopiesNoteText } from "@/lib/deletion/intake-copies";

const TEAM = "33333333-3333-4333-8333-333333333333";
const DRILL_TEAM = "44444444-4444-4444-8444-444444444444";
const item = (o: Partial<ShareLogItem> = {}): ShareLogItem => ({
  at: "2026-11-01T10:00:00Z",
  node: "avserv-2",
  teamId: TEAM,
  kind: "dispatch",
  subject: "sub-1",
  messageKind: "overdue",
  channel: "portal",
  fields: ["displayName", "lastFix"],
  reader: null,
  drill: false,
  ...o,
});

describe("alertKeysFromShareLog", () => {
  it("builds each alert id once across nodes and messages, drills included, feed reads not", () => {
    const r = alertKeysFromShareLog([
      { ok: true, node: "avserv-2", items: [item(), item({ messageKind: "all_clear" }), item({ kind: "feed_read", subject: "sub-9" })] },
      { ok: true, node: "avserv-3", items: [item({ node: "avserv-3" }), item({ teamId: DRILL_TEAM, subject: "sub-2", drill: true })] },
    ]);
    expect(r.keys).toEqual([
      { orgId: TEAM, alertId: `sub-1:${TEAM}` },
      { orgId: DRILL_TEAM, alertId: `sub-2:${DRILL_TEAM}` },
    ]);
    expect(r.unavailable).toEqual([]);
  });

  it("reports a node that didn't answer, and skips a team id that can't be ours", () => {
    const r = alertKeysFromShareLog([
      { ok: false, node: "avserv-2", code: "log_unavailable" },
      { ok: true, node: "avserv-3", items: [item({ teamId: "not-a-uuid" })] },
    ]);
    expect(r).toEqual({ keys: [], unavailable: [{ node: "avserv-2", code: "log_unavailable" }] });
  });
});

describe("intakeCopiesNoteText", () => {
  it("says what went, and what's left when a node didn't answer", () => {
    expect(intakeCopiesNoteText({ status: "complete", alerts: 0, messagesDeleted: 0, acksDeleted: 0, unavailable: [] })).toBe(
      "Portal: deleted 0 intake messages and 0 acks for 0 alerts (share log read from every node).",
    );
    expect(intakeCopiesNoteText({ status: "incomplete", alerts: 2, messagesDeleted: 5, acksDeleted: 1, unavailable: [{ node: "avserv-3", code: "unreachable" }] })).toBe(
      "Portal: deleted 5 intake messages and 1 ack for 2 alerts, but avserv-3 (unreachable) didn't answer: re-check the status to finish.",
    );
  });
});
