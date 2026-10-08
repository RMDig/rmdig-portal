import { beforeEach, describe, expect, it, vi } from "vitest";

// The CPA 45-day clock (lib/deletion/clock.ts): confirmed requests 30+ days
// old warn (Sentry warning + admin email), 40+ escalate (Sentry error), daily
// until completed. Nothing under 30 days, and nothing silent.

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  email: vi.fn(),
  captureMessage: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const rows = h.selects.shift() ?? [];
      const c: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "where"]) c[m] = () => c;
      c.orderBy = () => Promise.resolve(rows);
      c.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
      return c;
    },
  },
}));
vi.mock("@/lib/email/send", () => ({ sendDeletionClockEmail: h.email }));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://rmdig.ai" } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.captureMessage, captureException: vi.fn() }));

import { runDeletionClock } from "@/lib/deletion/clock";

const NOW = new Date("2026-10-07T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const ADMINS = [{ email: "a@rmdig.ai" }, { email: "b@rmdig.ai" }];

beforeEach(() => {
  vi.clearAllMocks();
  h.selects = [];
  h.email.mockResolvedValue(undefined);
});

describe("runDeletionClock", () => {
  it("does nothing when no confirmed request is 30 days in", async () => {
    h.selects = [[]];
    expect(await runDeletionClock(NOW)).toEqual({ open: 0, escalated: 0, emailed: 0, emailFailed: 0 });
    expect(h.captureMessage).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });

  it("warns at 30 days: a Sentry warning and an email to every admin, without the requester's address", async () => {
    h.selects = [[{ id: "req-1", confirmedAt: daysAgo(31) }], ADMINS];
    expect(await runDeletionClock(NOW)).toMatchObject({ open: 1, escalated: 0, emailed: 2 });
    expect(h.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/30\+ days/), expect.objectContaining({ level: "warning", tags: { event: "deletion.clock.warning" } }));
    expect(h.email).toHaveBeenCalledWith("a@rmdig.ai", {
      escalated: false,
      items: [{ requestId: "req-1", confirmedAtIso: daysAgo(31).toISOString(), dueIso: daysAgo(31 - 45).toISOString(), daysLeft: 14 }],
      queueUrl: "https://rmdig.ai/admin/deletion-requests",
    });
  });

  it("escalates at 40 days to a Sentry error", async () => {
    h.selects = [[{ id: "req-1", confirmedAt: daysAgo(41) }, { id: "req-2", confirmedAt: daysAgo(30) }], ADMINS];
    expect(await runDeletionClock(NOW)).toMatchObject({ open: 2, escalated: 1 });
    expect(h.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/40\+ days/), expect.objectContaining({ level: "error", tags: { event: "deletion.clock.escalated" } }));
    expect(h.email).toHaveBeenCalledWith("a@rmdig.ai", expect.objectContaining({ escalated: true }));
  });

  it("is loud when there's no admin to tell, and counts a failed email", async () => {
    h.selects = [[{ id: "req-1", confirmedAt: daysAgo(35) }], []];
    await runDeletionClock(NOW);
    expect(h.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tags: { event: "deletion.clock.no_admins" } }));

    h.selects = [[{ id: "req-1", confirmedAt: daysAgo(35) }], ADMINS];
    h.email.mockRejectedValueOnce(new Error("resend down"));
    expect(await runDeletionClock(NOW)).toMatchObject({ emailed: 1, emailFailed: 1 });
  });
});
