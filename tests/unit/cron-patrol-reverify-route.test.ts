import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ env: { CRON_SECRET: "" as string | undefined }, run: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/sar/reverify-run", () => ({ runReverifyReminders: h.run }));

import { GET } from "@/app/api/cron/patrol-reverify/route";

const SECRET = "c".repeat(64);
const call = (auth?: string) => GET(new Request("https://rmdig.ai/api/cron/patrol-reverify", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(h.log.error).toHaveBeenCalledWith({ event: "cron.patrol_reverify.unconfigured" });
  });
  it("answers 500 when the run fails", async () => {
    h.run.mockRejectedValue(new Error("db down"));
    expect((await call(`Bearer ${SECRET}`)).status).toBe(500);
  });
});
