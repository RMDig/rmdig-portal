import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "staff-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  nodes: [{ name: "a2", baseUrl: "https://a2" }],
  run: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => h.nodes }));
vi.mock("@/lib/avserv/checks", () => ({ runAvServChecks: h.run }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { runChecksAction } from "@/app/(portal)/admin/avserv-checks/actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "staff-1" };
  h.admin = true;
  h.nodes = [{ name: "a2", baseUrl: "https://a2" }];
});

describe("runChecksAction", () => {
  it("is for rmdig admins only", async () => {
    h.admin = false;
    expect(await runChecksAction(null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/platform administrator/) });
    expect(h.run).not.toHaveBeenCalled();
  });

  it("refuses loudly with no nodes configured", async () => {
    h.nodes = [];
    expect(await runChecksAction(null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/No AvAI servers/) });
    expect(h.log.error).toHaveBeenCalledWith({ event: "avserv.checks.no_nodes" });
  });

  it("returns the results, logging failures as errors", async () => {
    h.run.mockResolvedValue([{ check: "Email lookup", group: "account_lookup", node: "a2", ok: false, answer: "path_not_allowed" }]);
    const r = await runChecksAction(null, new FormData());
    expect(r).toMatchObject({ ok: true, results: [{ ok: false }] });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "avserv.checks.run", failed: ["a2:Email lookup:path_not_allowed"] }));
  });
});
