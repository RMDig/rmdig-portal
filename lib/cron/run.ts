import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { reportError } from "../report-error";
import { cronAuthFailure } from "./auth";
import { CRON_JOBS, type CronJob, MONITOR_CHECKIN_MARGIN_MINUTES, MONITOR_MAX_RUNTIME_MINUTES } from "./jobs";

// One way to run a scheduled job. The run is wrapped in its Sentry cron
// monitor, so Sentry alerts when a job fails AND when it stops running at all
// (a lost CRON_SECRET, a dropped vercel.json entry, a deploy that broke the
// route): pino alone tells nobody either. A thrown error is reported and
// answered 500; a run that finishes but reports a failure (ok: false) answers
// its own status and marks the check-in failed.

export interface CronResult {
  ok: boolean;
  body: unknown;
  /** The status for a failed run; 503 when unset. */
  status?: number;
}

class CronRunFailed extends Error {
  constructor(readonly result: CronResult) {
    super("cron run reported a failure");
  }
}

export async function runCron(req: Request, job: CronJob, work: () => Promise<CronResult>): Promise<NextResponse> {
  const { monitorSlug, schedule } = CRON_JOBS[job];
  try {
    const denied = cronAuthFailure(req, job);
    if (denied) return denied;
    const result = await Sentry.withMonitor(
      monitorSlug,
      async () => {
        const r = await work();
        if (!r.ok) throw new CronRunFailed(r);
        return r;
      },
      {
        schedule: { type: "crontab", value: schedule },
        timezone: "Etc/UTC",
        checkinMargin: MONITOR_CHECKIN_MARGIN_MINUTES,
        maxRuntime: MONITOR_MAX_RUNTIME_MINUTES,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    );
    return NextResponse.json(result.body);
  } catch (err) {
    if (err instanceof CronRunFailed) return NextResponse.json(err.result.body, { status: err.result.status ?? 503 });
    reportError(`cron.${job}.failed`, err);
    return NextResponse.json({ code: "run_failed" }, { status: 500 });
  } finally {
    // A serverless function can be frozen as soon as it answers; send the
    // check-in and any report first.
    await Sentry.flush(2000);
  }
}
