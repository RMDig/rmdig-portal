import { beforeEach, describe, expect, it, vi } from "vitest";

// The daily check for live SAR teams with no admin (plan 33 §6.4, step 9.13):
// nothing when every team has one; otherwise one email per SAR approver
// listing them all, reported to Sentry, and loud when nobody can be told.
// The SQL is tests/integration/sar-no-admin.test.ts.

const h = vi.hoisted(() => ({
  teams: [] as Array<{ id: string; name: string; status: string }>,
  staff: vi.fn(),
  send: vi.fn(),
  reportProblem: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db: { execute: () => Promise.resolve(h.teams) } }));
vi.mock("@/lib/auth/staff-recipients", () => ({ staffEmails: h.staff }));
vi.mock("@/lib/email/send", () => ({ sendSarNoAdminStaffEmail: h.send }));
vi.mock("@/lib/report-error", () => ({ reportProblem: h.reportProblem }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { runNoAdminCheck } from "@/lib/sar/no-admin";

beforeEach(() => {
  vi.clearAllMocks();
  h.teams = [];
  h.staff.mockResolvedValue(["op@rmdig.ai", "op2@rmdig.ai"]);
  h.send.mockResolvedValue(undefined);
});

describe("runNoAdminCheck", () => {
  it("does nothing when every live team has an admin", async () => {
    expect(await runNoAdminCheck()).toEqual({ teams: 0, sent: 0, failed: 0 });
    expect(h.staff).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.reportProblem).not.toHaveBeenCalled();
  });

  it("emails each SAR approver one list of every such team, and reports it", async () => {
    h.teams = [
      { id: "o1", name: "Alpha SAR", status: "approved" },
      { id: "o2", name: "Bravo SAR", status: "suspended" },
    ];
    expect(await runNoAdminCheck()).toEqual({ teams: 2, sent: 2, failed: 0 });
    expect(h.staff).toHaveBeenCalledWith(["rmdig_sar_approver"]);
    expect(h.send).toHaveBeenCalledWith("op@rmdig.ai", {
      teams: [{ name: "Alpha SAR", status: "approved" }, { name: "Bravo SAR", status: "suspended" }],
      queueUrl: expect.stringMatching(/\/admin\/sar-approvals$/),
    });
    expect(h.reportProblem).toHaveBeenCalledWith("sar.no_admin", expect.any(String), { teams: "o1,o2" });
  });

  it("counts a failed email and still tells the others", async () => {
    h.teams = [{ id: "o1", name: "Alpha SAR", status: "approved" }];
    h.send.mockRejectedValueOnce(new Error("resend down"));
    expect(await runNoAdminCheck()).toEqual({ teams: 1, sent: 1, failed: 1 });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.no_admin.staff_email_failed", to: "op@rmdig.ai" }));
  });

  it("reports loudly when there are no approvers to tell", async () => {
    h.teams = [{ id: "o1", name: "Alpha SAR", status: "approved" }];
    h.staff.mockResolvedValue([]);
    expect(await runNoAdminCheck()).toEqual({ teams: 1, sent: 0, failed: 0 });
    expect(h.reportProblem).toHaveBeenCalledWith("sar.no_admin.no_staff_to_notify", expect.any(String), { teams: 1 });
  });
});

describe("the erasure page's sole-admin warning (plan 37 P7f)", () => {
  it("names each team, marks a drill team, and says it doesn't hold up the erasure", async () => {
    const { soleAdminWarning } = await import("@/lib/sar/no-admin");
    const one = soleAdminWarning([{ name: "AvAI Drill Team", isDrill: true }]);
    expect(one).toContain("only admin of AvAI Drill Team (drill team)");
    expect(one).toContain("leaves that team with no admin");
    expect(one).toContain("doesn't hold up the erasure");
    const two = soleAdminWarning([{ name: "Alpha SAR", isDrill: false }, { name: "Bravo SAR", isDrill: false }]);
    expect(two).toContain("only admin of Alpha SAR, Bravo SAR");
    expect(two).toContain("leaves those teams");
  });

  it("asks nothing of the database for no users", async () => {
    const { soleAdminTeams } = await import("@/lib/sar/no-admin");
    h.teams = [{ id: "x", name: "should not be read", status: "approved" }];
    expect(await soleAdminTeams([])).toEqual([]);
  });
});
