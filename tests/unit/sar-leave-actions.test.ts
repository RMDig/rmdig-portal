import { beforeEach, describe, expect, it, vi } from "vitest";

// The team's leaving actions (plan 33 §6.9): admins only, behind two-factor,
// and giving notice takes a deliberate tick.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  change: vi.fn(),
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/sar/leaving", () => ({ changeLeaving: h.change }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { giveLeavingNoticeAction, undoLeavingAction } from "@/app/(portal)/sar/[orgId]/leave/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const fd = (confirm?: string) => {
  const f = new FormData();
  if (confirm) f.set("confirm", confirm);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "u1" };
  h.admin = true;
  h.change.mockResolvedValue({ ok: true, synced: true });
});

describe("the team's leaving actions", () => {
  it("gives notice with the tick, and undoes without one", async () => {
    expect(await giveLeavingNoticeAction(ORG, null, fd("on"))).toEqual({ ok: true, synced: true });
    expect(h.change).toHaveBeenLastCalledWith(ORG, "u1", "give_notice");
    expect(await undoLeavingAction(ORG, null, fd())).toEqual({ ok: true, synced: true });
    expect(h.change).toHaveBeenLastCalledWith(ORG, "u1", "undo");
  });

  it("won't give notice without the tick", async () => {
    expect(await giveLeavingNoticeAction(ORG, null, fd())).toMatchObject({ ok: false, error: expect.stringContaining("Tick the box") });
    expect(h.change).not.toHaveBeenCalled();
  });

  it("refuses a non-admin, a signed-out or unenrolled user, and a bad id", async () => {
    h.admin = false;
    expect(await giveLeavingNoticeAction(ORG, null, fd("on"))).toMatchObject({ ok: false, error: expect.stringContaining("admins") });
    expect(await undoLeavingAction(ORG, null, fd())).toMatchObject({ ok: false });
    h.admin = true;
    h.actor = { ok: false, error: "Set up two-factor authentication first." };
    expect(await undoLeavingAction(ORG, null, fd())).toEqual({ ok: false, error: "Set up two-factor authentication first." });
    h.actor = { ok: true, userId: "u1" };
    expect(await undoLeavingAction("nope", null, fd())).toMatchObject({ ok: false });
    expect(h.change).not.toHaveBeenCalled();
  });

  it("passes on the store's refusal", async () => {
    h.change.mockResolvedValue({ ok: false, error: "Your team isn't leaving, so there's nothing to undo." });
    expect(await undoLeavingAction(ORG, null, fd())).toEqual({ ok: false, error: "Your team isn't leaving, so there's nothing to undo." });
  });
});
