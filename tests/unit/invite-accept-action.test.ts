import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invite: [{ id: "inv-1", orgId: "org-1", role: "responder", createdByUserId: "admin-1" }] as Array<{
    id: string;
    orgId: string;
    role: string;
    createdByUserId: string;
  }>,
}));

vi.mock("@/lib/db", () => {
  const tx = {
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
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
});
