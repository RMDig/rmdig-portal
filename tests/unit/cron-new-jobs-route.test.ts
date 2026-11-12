import { beforeEach, describe, expect, it, vi } from "vitest";

// The SAR team-email retry, the SAR node check and the CPA deletion clock crons.
// Both go through lib/cron/run (auth, Sentry monitor, loud failure).

const SECRET = "n".repeat(64);
const h = vi.hoisted(() => ({
  env: { CRON_SECRET: "" as string | undefined },
  retry: vi.fn(),
  clock: vi.fn(),
  nodeCheck: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn(), captureMessage: vi.fn(), withMonitor: vi.fn(), flush: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
// Recording a success for the cron watch is tested in cron-watch.test.ts.
vi.mock("@/lib/cron/record", () => ({ recordCronSuccess: vi.fn(), cronWatchMissed: vi.fn(async () => false) }));
vi.mock("@sentry/nextjs", () => h.sentry);
vi.mock("@/lib/sar/alert-notify", () => ({ retryAlertNotifications: h.retry }));
vi.mock("@/lib/deletion/clock", () => ({ runDeletionClock: h.clock }));
vi.mock("@/lib/sar/node-check", () => ({ runNodeCheck: h.nodeCheck }));

import { GET as clockGET } from "@/app/api/cron/deletion-clock/route";
import { GET as notifyGET } from "@/app/api/cron/sar-alert-notify/route";
import { GET as nodeCheckGET } from "@/app/api/cron/sar-node-check/route";

const req = (path: string, auth = `Bearer ${SECRET}`) => new Request(`https://rmdig.ai${path}`, { headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  h.env.CRON_SECRET = SECRET;
  h.sentry.withMonitor.mockImplementation((_slug: string, cb: () => unknown) => cb());
  h.sentry.flush.mockResolvedValue(true);
});

describe("GET /api/cron/sar-node-check", () => {
  const summary = { owed: 1, resynced: 1, stillFailing: 0, crashed: 0, read: 3, readFailed: 0 };
  it("resends and reads under its monitor and returns the summary", async () => {
    h.nodeCheck.mockResolvedValue(summary);
    const res = await nodeCheckGET(req("/api/cron/sar-node-check"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(h.sentry.withMonitor).toHaveBeenCalledWith("portal-sar-node-check", expect.any(Function), expect.objectContaining({ checkinMargin: 10 }));
  });
  it("fails the run when a team's resend crashed, and refuses a wrong secret", async () => {
    h.nodeCheck.mockResolvedValue({ ...summary, resynced: 0, crashed: 1 });
    expect((await nodeCheckGET(req("/api/cron/sar-node-check"))).status).toBe(503);
    h.nodeCheck.mockClear();
    expect((await nodeCheckGET(req("/api/cron/sar-node-check", "Bearer nope"))).status).toBe(401);
    expect(h.nodeCheck).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/sar-alert-notify", () => {
  it("retries owed SAR team emails under its monitor and returns the summary", async () => {
    h.retry.mockResolvedValue({ due: 2, sent: 1, failed: 1, abandoned: 0, superseded: 0, skipped: 0 });
    const res = await notifyGET(req("/api/cron/sar-alert-notify"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ due: 2, sent: 1 });
    expect(h.sentry.withMonitor).toHaveBeenCalledWith("portal-sar-alert-notify", expect.any(Function), expect.anything());
  });
  it("refuses a wrong secret without running, and reports a crash", async () => {
    expect((await notifyGET(req("/api/cron/sar-alert-notify", "Bearer nope"))).status).toBe(401);
    expect(h.retry).not.toHaveBeenCalled();
    h.retry.mockRejectedValue(new Error("db down"));
    expect((await notifyGET(req("/api/cron/sar-alert-notify"))).status).toBe(500);
    expect(h.sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { event: "cron.sar_alert_notify.failed" } }));
  });
});

describe("GET /api/cron/deletion-clock", () => {
  it("runs the CPA clock under its monitor", async () => {
    h.clock.mockResolvedValue({ open: 1, escalated: 0, emailed: 1, emailFailed: 0 });
    const res = await clockGET(req("/api/cron/deletion-clock"));
    expect(res.status).toBe(200);
    expect(h.sentry.withMonitor).toHaveBeenCalledWith("portal-deletion-clock", expect.any(Function), expect.anything());
  });
  it("refuses an unconfigured CRON_SECRET loudly (Sentry), and reports a crash", async () => {
    h.env.CRON_SECRET = undefined;
    expect((await clockGET(req("/api/cron/deletion-clock"))).status).toBe(503);
    expect(h.sentry.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ tags: { event: "cron.deletion_clock.unconfigured" } }));
    h.env.CRON_SECRET = SECRET;
    h.clock.mockRejectedValue(new Error("db down"));
    expect((await clockGET(req("/api/cron/deletion-clock"))).status).toBe(500);
  });
});
