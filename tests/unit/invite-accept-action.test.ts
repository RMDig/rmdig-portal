import { beforeEach, describe, expect, it, vi } from "vitest";

const INVITE = { id: "inv-1", orgId: "org-1", email: "new@sar.org", role: "responder", createdByUserId: "admin-1" };

const h = vi.hoisted(() => ({
  invite: [] as Array<{ id: string; orgId: string; email: string; role: string; createdByUserId: string }>,
  joined: [{ userId: "user-1" }] as unknown[],
  // Rows the guarded claim UPDATE ... RETURNING changed; [] = lost a race.
  claimed: [{ id: "inv-1" }] as unknown[],
  claims: 0,
  memberInserts: 0,
  logs: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const tx = {
    insert: () => ({
      values: (v: unknown) => ({
        // org_memberships insert → onConflictDoNothing().returning(); the
        // org_membership_log insert is awaited directly.
        onConflictDoNothing: () => ({
          returning: () => {
            h.memberInserts++;
            return Promise.resolve(h.joined);
          },
        }),
        then: (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          h.logs.push(v);
          return Promise.resolve().then(res, rej);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            h.claims++;
            return Promise.resolve(h.claimed);
          },
        }),
      }),
    }),
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
  h.invite = [{ ...INVITE }];
  h.joined = [{ userId: "user-1" }];
  h.claimed = [{ id: "inv-1" }];
  h.claims = 0;
  h.memberInserts = 0;
  h.logs = [];
  authMock.mockResolvedValue({ user: { id: "user-2", email: "New@SAR.org" } } as never);
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

  it("accepts a valid invitation for the invited (case-insensitive) address and returns the org", async () => {
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res).toEqual({ ok: true, orgId: "org-1" });
    expect(h.claims).toBe(1);
    expect(h.memberInserts).toBe(1);
  });

  it("refuses a signed-in account whose email isn't the invited one, granting nothing", async () => {
    authMock.mockResolvedValue({ user: { id: "user-3", email: "someone-else@example.org" } } as never);
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res).toEqual({
      ok: false,
      error: "This invitation was issued to new@sar.org. Sign in with that account to accept it.",
    });
    expect(h.claims).toBe(0);
    expect(h.memberInserts).toBe(0);
  });

  it("refuses a session with no email (can't be bound to the invitation)", async () => {
    authMock.mockResolvedValue({ user: { id: "user-3" } } as never);
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res.ok).toBe(false);
    expect(h.claims).toBe(0);
  });

  it("grants nothing when a concurrent accept already claimed the invitation", async () => {
    h.claimed = [];
    const res = await acceptInvitationAction("tok", null, new FormData());
    expect(res).toEqual({ ok: false, error: "This invitation is invalid, already used, or has expired." });
    expect(h.memberInserts).toBe(0);
    expect(h.logs).toEqual([]);
  });

  it("logs a `joined` row only when the invitation actually added them", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", email: "new@sar.org" } } as never);
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
