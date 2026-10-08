import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily re-verification run: claim each stage once, send, and release the
// claim only when nobody could be told.

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  claimed: true,
  inserts: [] as unknown[],
  deletes: 0,
  staffEmail: vi.fn(),
  teamEmail: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: { NEXTAUTH_URL: "https://rmdig.ai" } }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/email/send", () => ({ sendPatrolReverifyStaffEmail: h.staffEmail, sendPatrolReverifyTeamEmail: h.teamEmail }));
vi.mock("@/lib/db", () => {
  const select = () => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin"]) c[m] = () => c;
    c.where = () => Promise.resolve(h.selects.shift() ?? []);
    return c;
  };
  return {
    db: {
      select,
      insert: () => ({
        values: (v: unknown) => ({
          onConflictDoNothing: () => ({
            returning: () => (h.inserts.push(v), Promise.resolve(h.claimed ? [{ orgId: "p1" }] : [])),
          }),
        }),
      }),
      delete: () => ({ where: () => (h.deletes++, Promise.resolve()) }),
    },
  };
});

import { runReverifyReminders } from "@/lib/sar/reverify-run";

const NOW = new Date("2026-10-04T15:00:00Z");
const patrol = (days: number) => ({ id: "p1", name: "Peak Patrol", reverifyBy: new Date(NOW.getTime() + days * 86_400_000), contactPhone: "+19705550100" });
const STAFF = [{ email: "ops@rmdig.ai" }];
const ADMINS = [{ email: "lead@patrol.org" }];

beforeEach(() => {
  vi.clearAllMocks();
  h.selects = [];
  h.claimed = true;
  h.inserts = [];
  h.deletes = 0;
  h.staffEmail.mockResolvedValue(undefined);
  h.teamEmail.mockResolvedValue(undefined);
});

describe("runReverifyReminders", () => {
  it("sends the 30-day notice to staff (with the number on file) and to the patrol's admins", async () => {
    h.selects = [[patrol(20)], STAFF, ADMINS];
    expect(await runReverifyReminders(NOW)).toEqual({ due: 1, sent: 2, failed: 0 });
    expect(h.inserts[0]).toMatchObject({ orgId: "p1", stage: "due_30" });
    expect(h.staffEmail).toHaveBeenCalledWith("ops@rmdig.ai", expect.objectContaining({ stage: "due_30", contactPhone: "+19705550100", reviewUrl: "https://rmdig.ai/admin/sar-approvals" }));
    expect(h.teamEmail).toHaveBeenCalledWith("lead@patrol.org", expect.objectContaining({ stage: "due_30", supportUrl: "https://rmdig.ai/support" }));
  });

  it("sends the 7-day reminder to staff only", async () => {
    h.selects = [[patrol(5)], STAFF];
    expect(await runReverifyReminders(NOW)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(h.teamEmail).not.toHaveBeenCalled();
  });

  it("sends nothing for a stage already sent, or when no patrol is due", async () => {
    h.claimed = false;
    h.selects = [[patrol(-1)], STAFF];
    expect(await runReverifyReminders(NOW)).toEqual({ due: 0, sent: 0, failed: 0 });
    expect(h.staffEmail).not.toHaveBeenCalled();
    h.selects = [[]];
    expect(await runReverifyReminders(NOW)).toEqual({ due: 0, sent: 0, failed: 0 });
  });

  it("releases the claim when every email fails, so tomorrow retries", async () => {
    h.selects = [[patrol(-1)], STAFF, ADMINS];
    h.staffEmail.mockRejectedValue(new Error("resend down"));
    h.teamEmail.mockRejectedValue(new Error("resend down"));
    expect(await runReverifyReminders(NOW)).toEqual({ due: 1, sent: 0, failed: 2 });
    expect(h.deletes).toBe(1);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.reverify.stage_unsent", stage: "lapsed" }));
  });

  it("keeps the claim when someone was told, logging the failed send", async () => {
    h.selects = [[patrol(-1)], STAFF, ADMINS];
    h.teamEmail.mockRejectedValue(new Error("bounced"));
    expect(await runReverifyReminders(NOW)).toEqual({ due: 1, sent: 1, failed: 1 });
    expect(h.deletes).toBe(0);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.reverify.email_failed" }));
  });

  it("logs loudly when there's no rmdig admin to tell", async () => {
    h.selects = [[patrol(20)], [], ADMINS];
    await runReverifyReminders(NOW);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.reverify.no_staff_recipients" }));
  });
});
