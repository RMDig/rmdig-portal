import { describe, expect, it, vi } from "vitest";

// Which copies an erasure deletes (plan 33 §6.9, F6): AvServ's alert id is
// `<subject>:<teamId>`, built from each dispatch in every node's share log;
// an approval decision is found by the acceptance id its list view logged.

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { ShareLogItem } from "@/lib/avserv/share-log";
import { copyKeysFromShareLog, intakeCopiesNoteText } from "@/lib/deletion/intake-copies";

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

describe("copyKeysFromShareLog", () => {
  it("builds each alert id once across nodes and messages, drills included, feed reads not", () => {
    const r = copyKeysFromShareLog([
      { ok: true, node: "avserv-2", items: [item(), item({ messageKind: "all_clear" }), item({ kind: "feed_read", subject: "sub-9" })] },
      { ok: true, node: "avserv-3", items: [item({ node: "avserv-3" }), item({ teamId: DRILL_TEAM, subject: "sub-2", drill: true })] },
    ]);
    expect(r.alerts).toEqual([
      { orgId: TEAM, alertId: `sub-1:${TEAM}` },
      { orgId: DRILL_TEAM, alertId: `sub-2:${DRILL_TEAM}` },
    ]);
    expect(r.acceptances).toEqual([]);
    expect(r.unavailable).toEqual([]);
  });

  it("finds each acceptance an approval list showed, once per team, and nothing from an area map view", () => {
    const view = (o: Partial<ShareLogItem> = {}) => item({ kind: "approval_request", subject: "acc-1", messageKind: null, channel: null, ...o });
    const r = copyKeysFromShareLog([
      { ok: true, node: "avserv-2", items: [view(), view(), view({ teamId: DRILL_TEAM }), item({ kind: "area_read", subject: "sub-7" })] },
      { ok: true, node: "avserv-3", items: [view({ node: "avserv-3" })] },
    ]);
    expect(r.acceptances).toEqual([
      { orgId: TEAM, acceptanceId: "acc-1" },
      { orgId: DRILL_TEAM, acceptanceId: "acc-1" },
    ]);
    expect(r.alerts).toEqual([]);
  });

  it("reports a node that didn't answer, and skips a team id that can't be ours", () => {
    const r = copyKeysFromShareLog([
      { ok: false, node: "avserv-2", code: "log_unavailable" },
      { ok: true, node: "avserv-3", items: [item({ teamId: "not-a-uuid" })] },
    ]);
    expect(r).toEqual({ alerts: [], acceptances: [], unavailable: [{ node: "avserv-2", code: "log_unavailable" }] });
  });
});

describe("intakeCopiesNoteText", () => {
  it("says what went, and what's left when a node didn't answer", () => {
    expect(intakeCopiesNoteText({ status: "complete", alerts: 0, messagesDeleted: 0, acksDeleted: 0, decisionsDeleted: 0, unavailable: [] })).toBe(
      "Portal: deleted 0 intake messages and 0 acks for 0 alerts, and 0 approval decisions (share log read from every node).",
    );
    expect(
      intakeCopiesNoteText({ status: "incomplete", alerts: 2, messagesDeleted: 5, acksDeleted: 1, decisionsDeleted: 1, unavailable: [{ node: "avserv-3", code: "unreachable" }] }),
    ).toBe(
      "Portal: deleted 5 intake messages and 1 ack for 2 alerts, and 1 approval decision, but avserv-3 (unreachable) didn't answer: re-check the status to finish.",
    );
  });
});
