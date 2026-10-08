import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: { CRON_SECRET: "" as string | undefined },
  run: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn(), captureMessage: vi.fn(), withMonitor: vi.fn(), flush: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => h.sentry);
vi.mock("@/lib/sar/reverify-run", () => ({ runReverifyReminders: h.run }));

import { GET } from "@/app/api/cron/patrol-reverify/route";

const SECRET = "c".repeat(64);
const call = (auth?: string) => GET(new Request("https://rmdig.ai/api/cron/patrol-reverify", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  h.sentry.withMonitor.mockImplementation((_slug: string, cb: () => unknown) => cb());
  h.sentry.flush.mockResolvedValue(true);
  h.env.CRON_SECRET = SECRET;
  h.run.mockResolvedValue({ due: 1, sent: 2, failed: 0 });
});

describe("GET /api/cron/patrol-reverify", () => {
  it("runs with Vercel's bearer secret and returns the summary", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ due: 1, sent: 2, failed: 0 });
  });
  it("refuses a missing or wrong secret without running", async () => {
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"x".repeat(64)}`)).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });
  it("answers 503 (and logs) when CRON_SECRET isn't configured", async () => {
    h.env.CRON_SECRET = undefined;
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    expect(h.sentry.captureMessage).toHaveBeenCalledWith(expect.stringMatching(/CRON_SECRET/), expect.objectContaining({ tags: { event: "cron.patrol_reverify.unconfigured" } }));
  });
  it("answers 500 when the run fails, and reports it to Sentry", async () => {
    const err = new Error("db down");
    h.run.mockRejectedValue(err);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
    expect(h.sentry.captureException).toHaveBeenCalledWith(err, expect.objectContaining({ tags: { event: "cron.patrol_reverify.failed" } }));
  });
  it("runs inside its Sentry cron monitor, on its vercel.json schedule", async () => {
    await call(`Bearer ${SECRET}`);
    expect(h.sentry.withMonitor).toHaveBeenCalledWith(
      "portal-patrol-reverify",
      expect.any(Function),
      expect.objectContaining({ schedule: { type: "crontab", value: "0 15 * * *" }, checkinMargin: 90 }),
    );
    expect(h.sentry.flush).toHaveBeenCalled();
  });
});
