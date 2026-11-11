import { beforeEach, describe, expect, it, vi } from "vitest";

// createDrillLoginAction (plan 37 §4.2) and createDrillUserAction (§4.11,
// P7b): rmdig_admin only; a new drill account at a drill address, its drill
// AvServ account made first, a member of one live drill team (a login) or of
// none (a user), and emailed a set-password link. An address with an account
// is refused before AvServ is asked; AvServ's refusal creates nothing; a
// failed email is said, never rolled back.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "admin-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  org: [{ isDrill: true, status: "pending" }] as unknown[],
  existing: [] as unknown[],
  inserts: [] as Array<{ table: string; v: Record<string, unknown> }>,
  txError: null as unknown,
  email: vi.fn(),
  account: vi.fn(),
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: (_u: string, r: string) => Promise.resolve(r === "rmdig_admin" && h.admin) }));
vi.mock("@/lib/email/send", () => ({ sendDrillLoginEmail: h.email }));
vi.mock("@/lib/sar/drill-avserv-account", () => ({ createDrillAvServAccount: h.account }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/db", () => {
  const name = (t: Record<symbol, string>) => t[Symbol.for("drizzle:Name")] ?? "";
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where"]) c[m] = () => c;
    c.limit = () => Promise.resolve(rows());
    return c;
  };
  const tx = {
    select: () => chain(() => h.existing),
    insert: (t: Record<symbol, string>) => ({
      values: (v: Record<string, unknown>) => {
        h.inserts.push({ table: name(t), v });
        return { returning: () => Promise.resolve([{ id: "drill-user-1" }]), then: (r: (x: unknown) => unknown) => Promise.resolve(undefined).then(r) };
      },
    }),
  };
  return {
    db: {
      // The address check reads users; the team lookup reads sar_orgs.
      select: () => ({ from: (t: Record<symbol, string>) => chain(() => (name(t) === "users" ? h.existing : h.org)) }),
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});

import { createDrillLoginAction, createDrillUserAction } from "@/app/(portal)/admin/sar-drill/actions";
import { hashResetToken } from "@/lib/auth/reset-tokens";

const ORG = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ email: "Ops+Drill1@rmdig.ai", role: "admin", ...o })) f.set(k, v);
  return f;
};
const tables = () => h.inserts.map((i) => i.table);

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "admin-1" };
  h.admin = true;
  h.org = [{ isDrill: true, status: "pending", name: "AvAI Drill Team" }];
  h.existing = [];
  h.inserts = [];
  h.txError = null;
  h.email.mockResolvedValue(undefined);
  h.account.mockResolvedValue({ ok: true, accountId: "acct-1" });
});

describe("createDrillLoginAction", () => {
  it("creates a drill account, its membership and log row, and emails a set-password link", async () => {
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: true, email: "ops+drill1@rmdig.ai", emailed: true });
    expect(tables()).toEqual(["users", "org_memberships", "org_membership_log", "password_reset_tokens"]);
    // Its drill AvServ account was made first, and its id is stored with it.
    expect(h.account).toHaveBeenCalledWith("ops+drill1@rmdig.ai", { userId: "admin-1", orgId: ORG });
    expect(h.inserts[0]!.v).toEqual({ email: "ops+drill1@rmdig.ai", isDrill: true, avservAccountId: "acct-1" });
    expect(h.inserts[1]!.v).toEqual({ orgId: ORG, userId: "drill-user-1", role: "admin", invitedByUserId: "admin-1" });
    expect(h.inserts[2]!.v).toMatchObject({ action: "joined", subjectEmail: "ops+drill1@rmdig.ai", toRole: "admin", actorUserId: "admin-1" });
    // The emailed link carries the token whose hash was stored, never the hash.
    // Its own drill-login email, naming the team, not a reset nobody asked for.
    const sent = h.email.mock.calls[0]![1] as { teamName: string; setPasswordUrl: string };
    expect(h.email.mock.calls[0]![0]).toBe("ops+drill1@rmdig.ai");
    expect(sent.teamName).toBe("AvAI Drill Team");
    const url = sent.setPasswordUrl;
    const token = new URL(url).searchParams.get("token")!;
    expect(h.inserts[3]!.v).toMatchObject({ userId: "drill-user-1", tokenHash: hashResetToken(token) });
    expect(url).not.toContain(h.inserts[3]!.v.tokenHash as string);
  });

  it("refuses anyone who isn't signed in, and anyone who isn't an rmdig admin", async () => {
    h.actor = { ok: false, error: "Sign in again." };
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: false, error: "Sign in again." });
    h.actor = { ok: true, userId: "lead-1" };
    h.admin = false;
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: false, error: "Only rmdig admins can create drill logins." });
    expect(h.inserts).toEqual([]);
  });

  it("refuses an address that isn't a drill address", async () => {
    for (const email of ["ops@rmdig.ai", "lead+drill@sar.org", "not-an-email"]) {
      expect(await createDrillLoginAction(ORG, null, form({ email }))).toMatchObject({ ok: false, fieldErrors: { email: [expect.stringContaining("drill address")] } });
    }
    expect(h.inserts).toEqual([]);
  });

  it("refuses a real team, an unknown one, and a rejected or withdrawn drill team", async () => {
    h.org = [{ isDrill: false, status: "approved" }];
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: false, error: "That drill team couldn't be found." });
    h.org = [];
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: false, error: "That drill team couldn't be found." });
    h.org = [{ isDrill: true, status: "withdrawn" }];
    expect(await createDrillLoginAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringContaining("withdrawn") });
    expect(h.inserts).toEqual([]);
  });

  it("never turns an existing account into a drill login, including one taken mid-request", async () => {
    h.existing = [{ id: "someone" }];
    expect(await createDrillLoginAction(ORG, null, form())).toMatchObject({ ok: false, fieldErrors: { email: [expect.stringContaining("already uses")] } });
    expect(h.inserts).toEqual([]);
    // Refused before AvServ is asked, so no account is made there either.
    expect(h.account).not.toHaveBeenCalled();
    h.existing = [];
    h.txError = Object.assign(new Error("dup"), { code: "23505" });
    expect(await createDrillLoginAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringContaining("already uses") });
  });

  it("keeps the login when the email fails, and says so loudly", async () => {
    h.email.mockRejectedValue(new Error("resend down"));
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: true, email: "ops+drill1@rmdig.ai", emailed: false });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.drill.login_email_failed", drillUserId: "drill-user-1" }));
  });

  it("fails loud on any other write error", async () => {
    h.txError = new Error("trigger refused");
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: false, error: "Couldn't create the drill login. Try again in a moment." });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.drill.login_failed" }));
    expect(h.email).not.toHaveBeenCalled();
  });
});

describe("the drill AvServ account, made first (P7b)", () => {
  it("creates nothing when AvServ refuses, and says why on the address", async () => {
    h.account.mockResolvedValue({ ok: false, error: "This address already has a real AvAI account.", field: "email" });
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({
      ok: false,
      error: "This address already has a real AvAI account.",
      fieldErrors: { email: ["This address already has a real AvAI account."] },
    });
    expect(h.inserts).toEqual([]);
    expect(h.email).not.toHaveBeenCalled();
  });

  it("creates nothing when AvServ can't be reached, and says so on the form", async () => {
    h.account.mockResolvedValue({ ok: false, error: "Couldn't create the drill account on AvAI. Try again in a moment." });
    expect(await createDrillLoginAction(ORG, null, form())).toEqual({ ok: false, error: "Couldn't create the drill account on AvAI. Try again in a moment.", fieldErrors: undefined });
    expect(h.inserts).toEqual([]);
  });
});

describe("createDrillUserAction (a drill account with no team)", () => {
  const userForm = (email = "Dennys+Drill2@rmdig.ai") => {
    const f = new FormData();
    f.set("email", email);
    return f;
  };

  it("creates the drill account with its AvServ id and no membership, and emails the user wording", async () => {
    expect(await createDrillUserAction(null, userForm())).toEqual({ ok: true, email: "dennys+drill2@rmdig.ai", emailed: true });
    expect(tables()).toEqual(["users", "password_reset_tokens"]);
    expect(h.inserts[0]!.v).toEqual({ email: "dennys+drill2@rmdig.ai", isDrill: true, avservAccountId: "acct-1" });
    expect(h.account).toHaveBeenCalledWith("dennys+drill2@rmdig.ai", { userId: "admin-1", orgId: null });
    const sent = h.email.mock.calls[0]![1] as { teamName: string | null; setPasswordUrl: string };
    expect(sent.teamName).toBeNull();
    const token = new URL(sent.setPasswordUrl).searchParams.get("token")!;
    expect(h.inserts[1]!.v).toMatchObject({ userId: "drill-user-1", tokenHash: hashResetToken(token) });
    expect(h.revalidate).toHaveBeenCalledWith("/admin/sar-drill");
  });

  it("refuses anyone who isn't an rmdig admin, and an address that isn't a drill address", async () => {
    h.admin = false;
    expect(await createDrillUserAction(null, userForm())).toEqual({ ok: false, error: "Only rmdig admins can create drill users." });
    h.admin = true;
    expect(await createDrillUserAction(null, userForm("dennys@rmdig.ai"))).toMatchObject({ ok: false, fieldErrors: { email: [expect.stringContaining("drill address")] } });
    expect(h.account).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
  });

  it("refuses a taken address before AvServ is asked, and keeps the user when the email fails", async () => {
    h.existing = [{ id: "someone" }];
    expect(await createDrillUserAction(null, userForm())).toMatchObject({ ok: false, error: expect.stringContaining("already uses") });
    expect(h.account).not.toHaveBeenCalled();
    h.existing = [];
    h.email.mockRejectedValue(new Error("resend down"));
    expect(await createDrillUserAction(null, userForm())).toEqual({ ok: true, email: "dennys+drill2@rmdig.ai", emailed: false });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.drill.user_email_failed" }));
  });
});
