import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CRON_JOBS } from "@/lib/cron/jobs";

// Each Sentry cron monitor expects runs on its job's schedule; vercel.json is
// what actually schedules them. They must agree, or a monitor reports missed
// runs that were never scheduled (or misses ones that were).

const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
  crons: Array<{ path: string; schedule: string }>;
};

describe("cron jobs", () => {
  it("vercel.json schedules exactly the jobs lib/cron/jobs monitors, on the same schedules", () => {
    const want = Object.values(CRON_JOBS).map((j) => ({ path: j.path, schedule: j.schedule }));
    expect([...vercel.crons].sort((a, b) => a.path.localeCompare(b.path))).toEqual(want.sort((a, b) => a.path.localeCompare(b.path)));
  });

  it("runs each job at most once a day (Vercel Hobby rejects anything more frequent)", () => {
    for (const { schedule } of vercel.crons) {
      const [minute, hour] = schedule.split(" ");
      expect(minute).toMatch(/^\d+$/);
      expect(hour).toMatch(/^\d+$/);
    }
  });

  it("gives every monitor its own slug", () => {
    const slugs = Object.values(CRON_JOBS).map((j) => j.monitorSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
