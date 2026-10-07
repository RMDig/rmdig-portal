import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: { CRON_SECRET: "c".repeat(64) as string | undefined },
  nodes: [{ name: "a2", baseUrl: "https://a2" }],
  run: vi.fn(),
  capture: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.capture }));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => h.nodes }));
vi.mock("@/lib/avserv/checks", () => ({ runAvServChecks: h.run }));

import { GET } from "@/app/api/cron/avserv-checks/route";

const call = () => GET(new Request("https://rmdig.ai/api/cron/avserv-checks", { headers: { authorization: `Bearer ${"c".repeat(64)}` } }));

beforeEach(() => {
  vi.clearAllMocks();
  h.nodes = [{ name: "a2", baseUrl: "https://a2" }];
});

describe("GET /api/cron/avserv-checks", () => {
  it("runs as portal-user:cron without the logged email lookup, and answers 200 when all pass", async () => {
    h.run.mockResolvedValue([{ check: "Team sync", group: "sar_sync", node: "a2", ok: true, answer: "ok" }]);
    expect((await call()).status).toBe(200);
    expect(h.run).toHaveBeenCalledWith("cron", { emailLookup: false });
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("answers 503 and alerts Sentry when any check fails", async () => {
    h.run.mockResolvedValue([{ check: "Red alerts feed", group: "sar_feed", node: "a2", ok: false, answer: "portal_fault: bad key" }]);
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, failed: ["a2: Red alerts feed: portal_fault: bad key"] });
    expect(h.capture).toHaveBeenCalledWith(expect.stringContaining("Red alerts feed"), "error");
  });

  it("answers 503 with no nodes configured, and 401 without the cron secret", async () => {
    h.nodes = [];
    expect((await call()).status).toBe(503);
    expect((await GET(new Request("https://rmdig.ai/api/cron/avserv-checks"))).status).toBe(401);
  });

  it("reports a node-health warning to Sentry as a warning without failing the run", async () => {
    h.run.mockResolvedValue([
      { check: "Team sync", group: "sar_sync", node: "a2", ok: true, answer: "ok" },
      { check: "Docker VM disk", group: "node_health", node: "a2", ok: false, warn: true, answer: "15.2% free" },
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, warned: ["a2: Docker VM disk: 15.2% free"] });
    expect(h.capture).toHaveBeenCalledWith(expect.stringContaining("Docker VM disk"), "warning");
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "cron.avserv_checks.warned" }));
  });
});
