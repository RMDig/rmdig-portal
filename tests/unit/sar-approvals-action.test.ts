import { beforeEach, describe, expect, it, vi } from "vitest";

// A confirm-first team's admins decide on a user's acceptance (plan 33 D4,
// 9.8): admins only, a confirm-first team AvServ holds, a known decision; a
// refusal from every node is explained in the team's words.

const h = vi.hoisted(() => ({
  userId: "admin-1" as string | undefined,
  canManage: true,
  org: [{ status: "approved", mode: "confirm_first" }] as unknown[],
  decide: vi.fn(),
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => c;
  c.limit = () => Promise.resolve(h.org);
  return { db: { select: () => c } };
});
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/sar/approvals", () => ({ decideAcceptance: h.decide }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { decideAction } from "@/app/(portal)/sar/[orgId]/approvals/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const decide = (state = "approved", acceptanceId = "acc-1") => {
  const f = new FormData();
  f.set("acceptanceId", acceptanceId);
  f.set("state", state);
  return decideAction(ORG, null, f);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "admin-1";
  h.canManage = true;
  h.org = [{ status: "approved", mode: "confirm_first" }];
  h.decide.mockResolvedValue({ ok: true });
});

describe("decideAction", () => {
  it("records and sends an admin's decision", async () => {
    expect(await decide("declined")).toEqual({ ok: true, state: "declined" });
    expect(h.decide).toHaveBeenCalledWith(ORG, "acc-1", "declined", "admin-1");
    expect(h.revalidate).toHaveBeenCalledWith(`/sar/${ORG}/approvals`);
  });

  it("refuses anyone but the team's admins, and an unknown decision", async () => {
    h.canManage = false;
    expect(await decide()).toEqual({ ok: false, error: "Only your team's admins can approve or decline people." });
    h.canManage = true;
    expect(await decide("maybe")).toEqual({ ok: false, error: "Unknown request." });
    expect(await decide("approved", "")).toEqual({ ok: false, error: "Unknown request." });
    h.userId = undefined;
    expect((await decide()).ok).toBe(false);
    expect(h.decide).not.toHaveBeenCalled();
  });

  it("refuses an open team, and a team AvServ doesn't hold", async () => {
    h.org = [{ status: "approved", mode: "open" }];
    expect(await decide()).toEqual({ ok: false, error: "Your team doesn't approve people first, so there's nothing to decide." });
    h.org = [{ status: "pending", mode: "confirm_first" }];
    expect((await decide()).ok).toBe(false);
    h.org = [];
    expect(await decide()).toEqual({ ok: false, error: "That team no longer exists." });
    expect(h.decide).not.toHaveBeenCalled();
  });

  it("explains a decision no node took, and logs it", async () => {
    h.decide.mockResolvedValue({ ok: false, code: "acceptance_revoked" });
    expect(await decide()).toEqual({ ok: false, error: "This person has withdrawn their acceptance of your terms, so there's nothing to decide." });
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.approvals.decide_refused", code: "acceptance_revoked" }));
  });
});
