import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: [{ name: "San Juan SAR", status: "approved" }] as Array<{ name: string; status: string }>,
  canManage: true,
  rlAllowed: true,
  rlKeys: [] as string[],
}));

vi.mock("@/lib/db", () => {
  const selChain: Record<string, unknown> = {
    from: () => selChain,
    where: () => selChain,
    limit: () => Promise.resolve(h.org),
  };
  return {
    db: {
      select: () => selChain,
      delete: () => ({ where: () => Promise.resolve() }),
      insert: () => ({ values: () => Promise.resolve() }),
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: vi.fn(() => Promise.resolve(h.canManage)) }));
vi.mock("@/lib/email/send", () => ({ sendOrgInviteEmail: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() });
  },
}));

import { auth } from "@/lib/auth";
import { sendOrgInviteEmail } from "@/lib/email/send";

import { createInvitationAction } from "@/app/(portal)/sar/[orgId]/members/actions";

const authMock = vi.mocked(auth);

function fd(email: string, role = "responder"): FormData {
  const f = new FormData();
  f.set("email", email);
  f.set("role", role);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.org = [{ name: "San Juan SAR", status: "approved" }];
  h.canManage = true;
  h.rlAllowed = true;
  h.rlKeys = [];
  authMock.mockResolvedValue({ user: { id: "admin-1" } } as never);
});

describe("createInvitationAction", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    expect((await createInvitationAction("org-1", null, fd("a@b.test"))).ok).toBe(false);
  });

  it("rejects a non-admin", async () => {
    h.canManage = false;
    const res = await createInvitationAction("org-1", null, fd("a@b.test"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/admin/i);
  });

  it("allows invites while the org is pending review (operator decision 2026-07-26)", async () => {
    h.org = [{ name: "San Juan SAR", status: "pending" }];
    const res = await createInvitationAction("org-1", null, fd("teammate@rmdig.ai"));
    expect(res.ok).toBe(true);
  });

  it("refuses to invite into a suspended org", async () => {
    h.org = [{ name: "San Juan SAR", status: "suspended" }];
    const res = await createInvitationAction("org-1", null, fd("a@b.test"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/suspended/i);
  });

  it("returns field errors for an invalid email", async () => {
    const res = await createInvitationAction("org-1", null, fd("not-an-email"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.email).toBeDefined();
  });

  it("creates an invitation, returns a link, and emails it", async () => {
    const res = await createInvitationAction("org-1", null, fd("Newbie@SAR.test", "responder"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.inviteUrl).toContain("/invite/");
      expect(res.email).toBe("newbie@sar.test"); // normalized
    }
    expect(sendOrgInviteEmail).toHaveBeenCalledWith(
      "newbie@sar.test",
      expect.objectContaining({ orgName: "San Juan SAR", role: "responder" }),
    );
  });

  it("still succeeds if the invite email fails to send", async () => {
    vi.mocked(sendOrgInviteEmail).mockRejectedValueOnce(new Error("resend down"));
    expect((await createInvitationAction("org-1", null, fd("a@b.test"))).ok).toBe(true);
  });

  it("keys the daily ceiling on the org", async () => {
    await createInvitationAction("org-1", null, fd("a@b.test"));
    expect(h.rlKeys).toContain("invite-org:org-1");
  });

  it("fails loud — no invite, no email — at the daily ceiling", async () => {
    h.rlAllowed = false;
    const res = await createInvitationAction("org-1", null, fd("a@b.test"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/daily invite limit/i);
    expect(sendOrgInviteEmail).not.toHaveBeenCalled();
  });
});
