import { beforeEach, describe, expect, it, vi } from "vitest";

// The SAR team-email retry and the CPA deletion clock crons.
// Both go through lib/cron/run (auth, Sentry monitor, loud failure).

const SECRET = "n".repeat(64);
const h = vi.hoisted(() => ({
  env: { CRON_SECRET: "" as string | undefined },
  retry: vi.fn(),
  clock: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn(), captureMessage: vi.fn(), withMonitor: vi.fn(), flush: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => h.sentry);
vi.mock("@/lib/sar/alert-notify", () => ({ retryAlertNotifications: h.retry }));
vi.mock("@/lib/deletion/clock", () => ({ runDeletionClock: h.clock }));

import { GET as clockGET } from "@/app/api/cron/deletion-clock/route";
import { GET as notifyGET } from "@/app/api/cron/sar-alert-notify/route";

const req = (path: string, auth = `Bearer ${SECRET}`) => new Request(`https://rmdig.ai${path}`, { headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  h.env.CRON_SECRET = SECRET;
  h.sentry.withMonitor.mockImplementation((_slug: string, cb: () => unknown) => cb());
  h.sentry.flush.mockResolvedValue(true);
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
