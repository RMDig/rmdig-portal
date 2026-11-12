import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CRON_JOBS } from "@/lib/cron/jobs";
import { parseSchedule } from "@/lib/cron/schedule";

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

  it("gives every job a schedule the watch and the monitors can judge: daily, or every N minutes", () => {
    for (const { schedule } of vercel.crons) expect(() => parseSchedule(schedule)).not.toThrow();
  });

  it("runs the team-email retry every minute and the node check every 5 (plan 33 9.11), security notices every 10 (S-D8)", () => {
    expect(CRON_JOBS.sar_alert_notify.schedule).toBe("* * * * *");
    expect(CRON_JOBS.sar_node_check.schedule).toBe("*/5 * * * *");
    expect(CRON_JOBS.security_notices.schedule).toBe("*/10 * * * *");
  });

  it("gives every monitor its own slug", () => {
    const slugs = Object.values(CRON_JOBS).map((j) => j.monitorSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
