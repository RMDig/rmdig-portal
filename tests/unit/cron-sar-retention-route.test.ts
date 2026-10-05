import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ env: { CRON_SECRET: "" as string | undefined }, run: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/sar/retention", () => ({ runSarRetention: h.run }));

import { GET } from "@/app/api/cron/sar-retention/route";

const SECRET = "r".repeat(64);
const call = (auth?: string) => GET(new Request("https://rmdig.ai/api/cron/sar-retention", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  h.env.CRON_SECRET = SECRET;
  h.run.mockResolvedValue({ positionsRemoved: 1, alertMessagesDeleted: 0, acksDeleted: 0, viewLogsDeleted: 0, staleOpenAlerts: 0 });
});

describe("GET /api/cron/sar-retention", () => {
  it("runs with Vercel's bearer secret", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ positionsRemoved: 1 });
  });
  it("refuses a wrong secret (401) and an unconfigured one (503) without running", async () => {
    expect((await call("Bearer nope")).status).toBe(401);
    h.env.CRON_SECRET = undefined;
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    expect(h.log.error).toHaveBeenCalledWith({ event: "cron.sar_retention.unconfigured" });
    expect(h.run).not.toHaveBeenCalled();
  });
  it("answers 500 when the run fails", async () => {
    h.run.mockRejectedValue(new Error("db down"));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "cron.sar_retention.failed" }));
  });
});
