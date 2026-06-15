import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: [{ status: "pending", name: "San Juan SAR", submitterEmail: "sub@sar.org" }] as Array<{
    status: string;
    name: string;
    submitterEmail: string;
  }>,
  staff: true,
}));

vi.mock("@/lib/db", () => {
  const tx = {
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
  const selChain: Record<string, unknown> = {
    from: () => selChain,
    innerJoin: () => selChain,
    where: () => selChain,
    limit: () => Promise.resolve(h.org),
  };
  return {
    db: {
      select: () => selChain,
      transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)),
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/auth/roles", () => ({ isPlatformStaff: vi.fn(() => Promise.resolve(h.staff)) }));
vi.mock("@/lib/email/send", () => ({ sendSarOrgDecisionEmail: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { sendSarOrgDecisionEmail } from "@/lib/email/send";

import { reviewSarOrgAction } from "@/app/(portal)/admin/sar-approvals/actions";

const authMock = vi.mocked(auth);
const ORG_ID = "11111111-1111-4111-8111-111111111111";

function fd(decision: string, note?: string): FormData {
  const f = new FormData();
  f.set("orgId", ORG_ID);
  f.set("decision", decision);
  if (note !== undefined) f.set("note", note);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.org = [{ status: "pending", name: "San Juan SAR", submitterEmail: "sub@sar.org" }];
  h.staff = true;
  authMock.mockResolvedValue({ user: { id: "admin-1" } } as never);
});

describe("reviewSarOrgAction", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    expect((await reviewSarOrgAction(null, fd("approve"))).ok).toBe(false);
  });

  it("rejects a non-staff caller", async () => {
    h.staff = false;
    const res = await reviewSarOrgAction(null, fd("approve"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/access/i);
  });

  it("requires a note when rejecting", async () => {
    const res = await reviewSarOrgAction(null, fd("reject"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.note).toBeDefined();
    expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
  });

  it("refuses a transition from the wrong status (approve a non-pending org)", async () => {
    h.org = [{ status: "approved", name: "San Juan SAR", submitterEmail: "sub@sar.org" }];
    const res = await reviewSarOrgAction(null, fd("approve"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/can't approve|approved/i);
  });

  it("suspends an approved org without emailing", async () => {
    h.org = [{ status: "approved", name: "San Juan SAR", submitterEmail: "sub@sar.org" }];
    const res = await reviewSarOrgAction(null, fd("suspend"));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
  });

  it("reactivates a suspended org without emailing", async () => {
    h.org = [{ status: "suspended", name: "San Juan SAR", submitterEmail: "sub@sar.org" }];
    const res = await reviewSarOrgAction(null, fd("reactivate"));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).not.toHaveBeenCalled();
  });

  it("won't suspend an org that isn't approved", async () => {
    // org defaults to pending
    const res = await reviewSarOrgAction(null, fd("suspend"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/can't suspend|pending/i);
  });

  it("approves and emails the submitter", async () => {
    const res = await reviewSarOrgAction(null, fd("approve"));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", {
      orgName: "San Juan SAR",
      decision: "approved",
      note: undefined,
    });
  });

  it("rejects with a note and emails the submitter", async () => {
    const res = await reviewSarOrgAction(null, fd("reject", "Couldn't verify your registration."));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", {
      orgName: "San Juan SAR",
      decision: "rejected",
      note: "Couldn't verify your registration.",
    });
  });

  it("requests changes with a note", async () => {
    const res = await reviewSarOrgAction(null, fd("request_changes", "Please add your county letter."));
    expect(res.ok).toBe(true);
    expect(sendSarOrgDecisionEmail).toHaveBeenCalledWith("sub@sar.org", {
      orgName: "San Juan SAR",
      decision: "changes_requested",
      note: "Please add your county letter.",
    });
  });
});
