import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invite: [{ id: "inv-1", orgId: "org-1", role: "responder", createdByUserId: "admin-1" }] as Array<{
    id: string;
    orgId: string;
    role: string;
    createdByUserId: string;
  }>,
  joined: [{ userId: "user-1" }] as unknown[],
  logs: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const tx = {
    insert: () => ({
      values: (v: unknown) => ({
        // org_memberships insert → onConflictDoNothing().returning(); the
        // org_membership_log insert is awaited directly.
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(h.joined) }),
        then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          h.logs.push(v);
          return Promise.resolve().then(res, rej);
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  const selChain: Record<string, unknown> = {
    from: () => selChain,
    where: () => selChain,
    limit: () => Promise.resolve(h.invite),
  };
  return {
    db: {
      select: () => selChain,
      transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)),
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { auth } from "@/lib/auth";

import { acceptInvitationAction } from "@/app/invite/[token]/actions";

const authMock = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  h.invite = [{ id: "inv-1", orgId: "org-1", role: "responder", createdByUserId: "admin-1" }];
  h.joined = [{ userId: "user-1" }];
  h.logs = [];
  authMock.mockResolvedValue({ user: { id: "user-2" } } as never);
});

describe("acceptInvitationAction", () => {
  it("asks an unauthenticated caller to sign in", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sign in/i);
  });

  it("rejects an invalid or expired token", async () => {
    h.invite = [];
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid|expired/i);
  });

  it("accepts a valid invitation and returns the org", async () => {
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res).toEqual({ ok: true, orgId: "org-1" });
  });

  it("logs a `joined` row only when the invitation actually added them", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } } as never);
    h.invite = [{ id: "inv-1", orgId: "org-1", email: "new@sar.org", role: "responder", createdByUserId: "admin-1" } as never];
    await acceptInvitationAction("tok", null, new FormData());
    expect(h.logs).toEqual([
      expect.objectContaining({ orgId: "org-1", action: "joined", subjectUserId: "user-1", subjectEmail: "new@sar.org", toRole: "responder" }),
    ]);
    h.logs = [];
    h.joined = [];
    await acceptInvitationAction("tok", null, new FormData());
    expect(h.logs).toEqual([]);
  });
});
