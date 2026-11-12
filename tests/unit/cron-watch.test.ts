import { beforeEach, describe, expect, it, vi } from "vitest";

// The cron watch (lib/cron/watch.ts): one Sentry monitor on the watch, and the
// watch catches any other job that stopped running.

const h = vi.hoisted(() => ({
  rows: [] as Array<{ job: string; lastSuccessAt: Date | null; watchedSince: Date }>,
  inserted: [] as unknown[],
  staff: vi.fn(),
  send: vi.fn(),
  problem: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: (v: unknown) => ({ onConflictDoNothing: async () => void h.inserted.push(v) }) }),
    select: () => ({ from: async () => h.rows }),
  },
}));
vi.mock("@/lib/auth/staff-recipients", () => ({ staffEmails: h.staff }));
vi.mock("@/lib/email/send", () => ({ sendCronWatchStaffEmail: h.send }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.problem, reportError: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { CRON_JOBS, type CronJob } from "@/lib/cron/jobs";
import { lastDueRun, marginMinutes, parseSchedule } from "@/lib/cron/schedule";
import { lateJobs, runCronWatch } from "@/lib/cron/watch";

const at = (iso: string) => new Date(iso);
// The watch's own run time on 2026-11-11.
const NOW = at("2026-11-11T19:30:00Z");
const OTHERS = (Object.keys(CRON_JOBS) as CronJob[]).filter((j) => j !== "cron_watch");
// Daily jobs ran at their time today; every-N-minutes jobs a minute ago.
const allRanToday = () =>
  OTHERS.map((job) => {
    const s = parseSchedule(CRON_JOBS[job].schedule);
    const lastSuccessAt =
      s.kind === "daily" ? at(`2026-11-11T${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}:20Z`) : new Date(NOW.getTime() - 60_000);
    return { job, lastSuccessAt, watchedSince: at("2026-11-01T00:00:00Z") };
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.inserted = [];
  h.rows = allRanToday();
  h.staff.mockResolvedValue(["admin@rmdig.ai"]);
  h.send.mockResolvedValue(undefined);
});

describe("lastDueRun", () => {
  it("is today's run once its margin has passed, else yesterday's", () => {
    expect(lastDueRun("0 17 * * *", NOW)).toEqual(at("2026-11-11T17:00:00Z"));
    // 18:00 + 90 minutes is 19:30: due exactly now.
    expect(lastDueRun("0 18 * * *", NOW)).toEqual(at("2026-11-11T18:00:00Z"));
    expect(lastDueRun("30 18 * * *", NOW)).toEqual(at("2026-11-10T18:30:00Z"));
    expect(lastDueRun("30 9 * * *", at("2026-11-11T00:10:00Z"))).toEqual(at("2026-11-10T09:30:00Z"));
  });

  it("for an every-N-minutes job, is the latest run more than two runs (at least five minutes) ago", () => {
    expect(marginMinutes("*/10 * * * *")).toBe(20);
    expect(marginMinutes("*/5 * * * *")).toBe(10);
    expect(marginMinutes("* * * * *")).toBe(5);
    expect(marginMinutes("0 17 * * *")).toBe(90);
    expect(lastDueRun("*/10 * * * *", at("2026-11-11T19:35:00Z"))).toEqual(at("2026-11-11T19:10:00Z"));
    expect(lastDueRun("*/10 * * * *", at("2026-11-11T19:30:00Z"))).toEqual(at("2026-11-11T19:10:00Z"));
    expect(lastDueRun("* * * * *", NOW)).toEqual(at("2026-11-11T19:25:00Z"));
    // Across midnight.
    expect(lastDueRun("*/5 * * * *", at("2026-11-12T00:04:00Z"))).toEqual(at("2026-11-11T23:50:00Z"));
  });

  it("refuses any other schedule shape, so a job the watch can't judge fails here", () => {
    for (const bad of ["*/7 * * * *", "0 */2 * * *", "0 17 * * 1", "0 17 1 * *", "60 1 * * *", "0 24 * * *", "*/0 * * * *", "daily"]) {
      expect(() => parseSchedule(bad)).toThrow(/unsupported schedule/);
    }
    expect(parseSchedule("30 9 * * *")).toEqual({ kind: "daily", minute: 30, hour: 9 });
    expect(parseSchedule("*/5 * * * *")).toEqual({ kind: "every", minutes: 5 });
  });

  it("finds every other job's run of the day due by the watch's own time", () => {
    const [m, hr] = CRON_JOBS.cron_watch.schedule.split(" ").map(Number);
    const watchAt = new Date(Date.UTC(2026, 10, 11, hr, m));
    for (const job of OTHERS) {
      expect(lastDueRun(CRON_JOBS[job].schedule, watchAt).getUTCDate()).toBe(11);
    }
  });
});

describe("lateJobs", () => {
  it("finds none when every job ran today", () => {
    expect(lateJobs(h.rows, NOW)).toEqual([]);
  });

  it("calls an every-N-minutes job late once it has missed more than its margin", () => {
    const stopped = h.rows.map((r) => (r.job === "sar_node_check" ? { ...r, lastSuccessAt: at("2026-11-11T19:14:00Z") } : r));
    expect(lateJobs(stopped, NOW)).toEqual([
      { job: "sar_node_check", path: "/api/cron/sar-node-check", dueAt: at("2026-11-11T19:20:00Z"), lastSuccessAt: at("2026-11-11T19:14:00Z") },
    ]);
    const justLate = h.rows.map((r) => (r.job === "sar_node_check" ? { ...r, lastSuccessAt: at("2026-11-11T19:20:05Z") } : r));
    expect(lateJobs(justLate, NOW)).toEqual([]);
  });

  it("finds a job whose last success is before the run it owes", () => {
    const rows = h.rows.map((r) => (r.job === "deletion_clock" ? { ...r, lastSuccessAt: at("2026-11-10T16:02:00Z") } : r));
    expect(lateJobs(rows, NOW)).toEqual([
      { job: "deletion_clock", path: "/api/cron/deletion-clock", dueAt: at("2026-11-11T16:00:00Z"), lastSuccessAt: at("2026-11-10T16:02:00Z") },
    ]);
  });

  it("calls a job that never succeeded late, unless the watch first saw it after the run it owes", () => {
    const never = h.rows.map((r) => (r.job === "expired_rows" ? { ...r, lastSuccessAt: null } : r));
    expect(lateJobs(never, NOW).map((l) => l.job)).toEqual(["expired_rows"]);
    const newToday = never.map((r) => (r.job === "expired_rows" ? { ...r, watchedSince: at("2026-11-11T12:00:00Z") } : r));
    expect(lateJobs(newToday, NOW)).toEqual([]);
  });

  it("never checks the watch itself, and fails loudly on a missing row", () => {
    expect(lateJobs([...h.rows, { job: "cron_watch", lastSuccessAt: null, watchedSince: at("2026-01-01T00:00:00Z") }], NOW)).toEqual([]);
    expect(() => lateJobs(h.rows.slice(1), NOW)).toThrow(/no cron_runs row/);
  });
});

describe("runCronWatch", () => {
  it("starts watching every job and stays quiet when all ran", async () => {
    expect(await runCronWatch(NOW)).toEqual({ watched: OTHERS.length, late: [], emailed: 0, emailFailed: 0 });
    expect(h.inserted[0]).toHaveLength(Object.keys(CRON_JOBS).length);
    expect(h.problem).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("reports a late job to Sentry and emails each rmdig admin", async () => {
    h.rows = h.rows.map((r) => (r.job === "sar_retention" ? { ...r, lastSuccessAt: at("2026-11-09T09:31:00Z") } : r));
    h.staff.mockResolvedValue(["a@rmdig.ai", "b@rmdig.ai"]);
    expect(await runCronWatch(NOW)).toMatchObject({ late: ["sar_retention"], emailed: 2, emailFailed: 0 });
    expect(h.staff).toHaveBeenCalledWith(["rmdig_admin"]);
    expect(h.problem).toHaveBeenCalledWith("cron.watch.late", expect.any(String), { jobs: "sar_retention" });
    expect(h.send).toHaveBeenCalledWith("a@rmdig.ai", {
      jobs: [{ path: "/api/cron/sar-retention", dueAt: "2026-11-11T09:30:00.000Z", lastSuccessAt: "2026-11-09T09:31:00.000Z" }],
    });
  });

  it("counts a failed email, and reports when there's no admin to tell", async () => {
    h.rows = h.rows.map((r) => (r.job === "sar_retention" ? { ...r, lastSuccessAt: null } : r));
    h.send.mockRejectedValue(new Error("resend down"));
    expect(await runCronWatch(NOW)).toMatchObject({ late: ["sar_retention"], emailed: 0, emailFailed: 1 });
    h.staff.mockResolvedValue([]);
    expect(await runCronWatch(NOW)).toMatchObject({ late: ["sar_retention"], emailed: 0 });
    expect(h.problem).toHaveBeenCalledWith("cron.watch.no_admins", expect.any(String), { jobs: "sar_retention" });
  });
});
