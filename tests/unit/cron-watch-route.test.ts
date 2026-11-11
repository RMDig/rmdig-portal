import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/cron/cron-watch, and the success record every job leaves for it
// (lib/cron/run.ts → lib/cron/record.ts).

const SECRET = "w".repeat(64);
const h = vi.hoisted(() => ({
  env: { CRON_SECRET: "" as string | undefined },
  watch: vi.fn(),
  record: vi.fn(),
  missed: vi.fn(),
  clock: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn(), captureMessage: vi.fn(), withMonitor: vi.fn(), flush: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => h.sentry);
vi.mock("@/lib/cron/watch", () => ({ runCronWatch: h.watch }));
vi.mock("@/lib/cron/record", () => ({ recordCronSuccess: h.record, cronWatchMissed: h.missed }));
vi.mock("@/lib/deletion/clock", () => ({ runDeletionClock: h.clock }));

import { GET } from "@/app/api/cron/cron-watch/route";
import { GET as clockGET } from "@/app/api/cron/deletion-clock/route";

const req = (auth = `Bearer ${SECRET}`) => new Request("https://rmdig.ai/api/cron/cron-watch", { headers: { authorization: auth } });
const quiet = { watched: 8, late: [], emailed: 0, emailFailed: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  h.env.CRON_SECRET = SECRET;
  h.sentry.withMonitor.mockImplementation((_slug: string, cb: () => unknown) => cb());
  h.sentry.flush.mockResolvedValue(true);
  h.watch.mockResolvedValue(quiet);
  h.record.mockResolvedValue(undefined);
  h.missed.mockResolvedValue(false);
  h.clock.mockResolvedValue({ open: 0, escalated: 0, emailed: 0, emailFailed: 0 });
});

describe("GET /api/cron/cron-watch", () => {
  it("runs under its own monitor, answers 200 and records its success when nothing is late", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(quiet);
    expect(h.sentry.withMonitor).toHaveBeenCalledWith("portal-cron-watch", expect.any(Function), expect.objectContaining({ schedule: { type: "crontab", value: "30 19 * * *" } }));
    expect(h.record).toHaveBeenCalledWith("cron_watch");
  });

  it("fails its check-in (503) when a job is late, so the monitor alerts too, and records no success", async () => {
    h.watch.mockResolvedValue({ ...quiet, late: ["deletion_clock"], emailed: 1 });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ late: ["deletion_clock"] });
    expect(h.record).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret without running", async () => {
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect(h.watch).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it("reports a crash and records no success", async () => {
    h.watch.mockRejectedValue(new Error("db down"));
    expect((await GET(req())).status).toBe(500);
    expect(h.sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { event: "cron.cron_watch.failed" } }));
    expect(h.record).not.toHaveBeenCalled();
  });

  it("never checks whether it missed its own run", async () => {
    h.missed.mockResolvedValue(true);
    expect((await GET(req())).status).toBe(200);
    expect(h.missed).not.toHaveBeenCalled();
    expect(h.sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("keeps a successful run's 200 when its record fails, and reports the record loudly", async () => {
    h.record.mockRejectedValue(new Error("db down"));
    expect((await GET(req())).status).toBe(200);
    expect(h.sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { event: "cron.cron_watch.record_failed" } }));
  });
});

describe("every other job checks the watch ran (no Sentry monitor needed)", () => {
  const clockReq = () => new Request("https://rmdig.ai/api/cron/deletion-clock", { headers: { authorization: `Bearer ${SECRET}` } });

  it("records its own success and stays quiet when the watch ran", async () => {
    expect((await clockGET(clockReq())).status).toBe(200);
    expect(h.record).toHaveBeenCalledWith("deletion_clock");
    expect(h.missed).toHaveBeenCalledOnce();
    expect(h.sentry.captureMessage).not.toHaveBeenCalled();
  });

  it("reports a missed watch to Sentry, and still answers 200 for its own run", async () => {
    h.missed.mockResolvedValue(true);
    expect((await clockGET(clockReq())).status).toBe(200);
    expect(h.sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("cron watch didn't run"),
      expect.objectContaining({ tags: { event: "cron.watch.missed" }, extra: { checkedBy: "deletion_clock" } }),
    );
  });

  it("doesn't check the watch when its own run failed", async () => {
    h.clock.mockRejectedValue(new Error("db down"));
    expect((await clockGET(clockReq())).status).toBe(500);
    expect(h.missed).not.toHaveBeenCalled();
  });
});
