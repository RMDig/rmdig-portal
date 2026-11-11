import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/cron/record.ts: a job's success record, and the check every other job
// makes that the cron watch ran (so the watch needs no Sentry monitor).

const h = vi.hoisted(() => ({
  watchRow: [] as Array<{ job: string; lastSuccessAt: Date | null; watchedSince: Date }>,
  upserts: [] as Array<{ values: unknown; set: unknown }>,
}));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async (o: { set: unknown }) => void h.upserts.push({ values, set: o.set }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.watchRow }) }) }),
  },
}));

import { cronWatchMissed, recordCronSuccess } from "@/lib/cron/record";

const at = (iso: string) => new Date(iso);
const LONG_AGO = at("2026-11-01T00:00:00Z");

beforeEach(() => {
  h.watchRow = [];
  h.upserts = [];
});

describe("recordCronSuccess", () => {
  it("upserts the job's last success", async () => {
    await recordCronSuccess("deletion_clock", at("2026-11-11T16:03:00Z"));
    expect(h.upserts).toEqual([
      { values: { job: "deletion_clock", lastSuccessAt: at("2026-11-11T16:03:00Z") }, set: { lastSuccessAt: at("2026-11-11T16:03:00Z") } },
    ]);
  });
});

describe("cronWatchMissed", () => {
  it("is false until the watch has run once", async () => {
    expect(await cronWatchMissed(at("2026-11-12T16:00:00Z"))).toBe(false);
  });

  it("is false the morning after a watch that ran at 19:30", async () => {
    h.watchRow = [{ job: "cron_watch", lastSuccessAt: at("2026-11-11T19:31:00Z"), watchedSince: LONG_AGO }];
    expect(await cronWatchMissed(at("2026-11-12T09:30:00Z"))).toBe(false);
  });

  it("is true the morning after a watch that didn't run", async () => {
    h.watchRow = [{ job: "cron_watch", lastSuccessAt: at("2026-11-10T19:31:00Z"), watchedSince: LONG_AGO }];
    expect(await cronWatchMissed(at("2026-11-12T09:30:00Z"))).toBe(true);
  });

  it("is true for a watch that failed every run (no success recorded)", async () => {
    h.watchRow = [{ job: "cron_watch", lastSuccessAt: null, watchedSince: LONG_AGO }];
    expect(await cronWatchMissed(at("2026-11-12T09:30:00Z"))).toBe(true);
  });
});
