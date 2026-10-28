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
vi.mock("@/lib/retention/expired-rows", () => ({ deleteExpiredRows: h.run }));

import { GET } from "@/app/api/cron/expired-rows/route";

const SECRET = "r".repeat(64);
const call = (auth?: string) => GET(new Request("https://rmdig.ai/api/cron/expired-rows", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  h.sentry.withMonitor.mockImplementation((_slug: string, cb: () => unknown) => cb());
  h.sentry.flush.mockResolvedValue(true);
  h.env.CRON_SECRET = SECRET;
  h.run.mockResolvedValue({ sessions: 4, passwordResetTokens: 0, verificationTokens: 1, unconfirmedDeletionRequests: 0, rateLimits: 9 });
});

describe("GET /api/cron/expired-rows", () => {
  it("runs with Vercel's bearer secret and reports the counts", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sessions: 4, rateLimits: 9 });
    expect(h.sentry.withMonitor).toHaveBeenCalledWith("portal-expired-rows", expect.any(Function), expect.anything());
  });
  it("refuses a wrong secret without running", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });
  it("answers 500 and reports when the run fails", async () => {
    h.run.mockRejectedValue(new Error("db down"));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
    expect(h.sentry.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { event: "cron.expired_rows.failed" } }));
  });
});
