import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// Advertiser account creation, member invitation and invitation acceptance,
// run as sequences against the in-memory Drizzle stand-in (helpers/fake-db).
// The fake is hardened below with what these actions lean on: generated ids,
// unique indexes, onConflictDoNothing, transaction rollback and injected
// write failures. The membership check (canManageAdvertiser) runs for real
// against the same tables, so role gating is exercised, not stubbed.

type Row = import("./helpers/fake-db").Row;
type Actor = { ok: true; userId: string } | { ok: false; error: string };

const h = vi.hoisted(() => ({
  fake: null as null | import("./helpers/fake-db").FakeDb,
  db: {} as Record<string, unknown>,
  env: { FEATURE_ADVERTISER_PORTAL: "on", NEXTAUTH_URL: "https://app.example.test" } as Record<string, string | undefined>,
  actor: { ok: true, userId: "u-admin" } as Actor,
  session: null as null | { user: { id: string; email?: string } },
  phoneGate: { ok: true, phone: "+13035550100" } as
    | { ok: true; phone: string | null }
    | { ok: false; error: string; fieldErrors: Record<string, string[]> },
  failInsert: null as string | null,
  // Runs once at the start of the next transaction: a competing request
  // landing between an action's read and its write.
  beforeTx: null as null | (() => Promise<unknown>),
  sendInvite: vi.fn(),
  phoneCheck: vi.fn(),
  revalidate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("drizzle-orm", async () => (await import("./helpers/fake-db")).fakeOperators);
vi.mock("@/lib/db/schema", async () => {
  const { fakeTable } = await import("./helpers/fake-db");
  return {
    users: fakeTable("users"),
    advertiserAccounts: fakeTable("advertiserAccounts"),
    advertiserMemberships: fakeTable("advertiserMemberships"),
    advertiserInvitations: fakeTable("advertiserInvitations"),
    advertiserRole: { enumValues: ["admin", "editor"] },
  };
});
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.session) }));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/phone/org-phone", () => ({
  requireVerifiedOrgPhone: (...args: unknown[]) => (h.phoneCheck(...args), Promise.resolve(h.phoneGate)),
}));
vi.mock("@/lib/email/send", () => ({ sendAdvertiserInviteEmail: h.sendInvite }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { createAdvertiserAccountAction } from "@/app/(portal)/advertiser/new/actions";
import { createAdvertiserInvitationAction } from "@/app/(portal)/advertiser/[advertiserId]/members/actions";
import { acceptAdvertiserInvitationAction } from "@/app/advertiser-invite/[token]/actions";

import { createFakeDb } from "./helpers/fake-db";

// Unique indexes the actions depend on (lib/db/schema): the per-phone index on
// accounts, the membership PK, the token-hash unique on invitations.
const UNIQUE: Record<string, (r: Row) => unknown> = {
  advertiserAccounts: (r) => r.contactPhone ?? null,
  advertiserMemberships: (r) => `${String(r.advertiserId)}:${String(r.userId)}`,
  advertiserInvitations: (r) => r.tokenHash,
};
const DEFAULTS: Record<string, () => Row> = {
  advertiserAccounts: () => ({ id: crypto.randomUUID(), status: "active" }),
  advertiserInvitations: () => ({ id: crypto.randomUUID(), acceptedAt: null, acceptedByUserId: null }),
};

function hardenedDb(): Record<string, unknown> {
  const fake = createFakeDb();
  h.fake = fake;
  const base = fake.db as {
    insert: (t: { __t: string }) => { values: (v: Row) => Promise<void> & { returning: (f?: Record<string, string>) => Promise<Row[]> } };
  };
  const db: Record<string, unknown> = { ...fake.db };
  db.insert = (table: { __t: string }) => ({
    values: (vals: Row) => {
      const row = { ...DEFAULTS[table.__t]?.(), ...vals };
      const key = UNIQUE[table.__t];
      const conflict = () => key !== undefined && key(row) !== null && fake.rows(table.__t).some((r) => key(r) === key(row));
      const write = () => {
        if (h.failInsert === table.__t) throw new Error(`${table.__t} insert failed`);
        if (conflict()) throw Object.assign(new Error("duplicate key value"), { code: "23505" });
        return base.insert(table).values(row);
      };
      return {
        then: (ok: (v: void) => unknown, bad: (e: unknown) => unknown) => Promise.resolve().then(() => void write()).then(ok, bad),
        returning: (f?: Record<string, string>) => Promise.resolve().then(() => write().returning(f)),
        onConflictDoNothing: () => Promise.resolve().then(() => void (conflict() ? undefined : write())),
      };
    },
  });
  // All-or-nothing, like Postgres: a throw inside restores every table.
  db.transaction = async <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => {
    const hook = h.beforeTx;
    h.beforeTx = null;
    if (hook) await hook();
    const snapshot = new Map([...fake.tables].map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
    try {
      return await fn(db);
    } catch (err) {
      fake.tables.clear();
      for (const [k, rows] of snapshot) fake.tables.set(k, rows);
      throw err;
    }
  };
  return db;
}

const rows = (t: string): Row[] => h.fake!.rows(t);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const accountForm = (o: Record<string, string> = {}) =>
  fd({ name: "Summit Gear", contactName: "Pat Doe", contactEmail: " Pat@Summit.Example ", contactPhone: "303-555-0100", websiteUrl: "https://summit.example", tosAccepted: "on", ...o });

const ADV = "adv-1";
const asUser = (id: string, email: string) => {
  h.session = { user: { id, email } };
};
// An admin invites `email`; returns the plaintext token from the emailed link.
async function invite(email: string, role = "editor"): Promise<string> {
  const res = await createAdvertiserInvitationAction(ADV, null, fd({ email, role }));
  if (!res.ok) throw new Error(`invite failed: ${res.error}`);
  return res.inviteUrl.split("/advertiser-invite/")[1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(h.db)) delete h.db[k];
  Object.assign(h.db, hardenedDb());
  h.env.FEATURE_ADVERTISER_PORTAL = "on";
  h.actor = { ok: true, userId: "u-admin" };
  h.session = null;
  h.phoneGate = { ok: true, phone: "+13035550100" };
  h.failInsert = null;
  h.beforeTx = null;
  h.sendInvite.mockResolvedValue(undefined);
  rows("users").push({ id: "u-admin", emailVerified: new Date("2026-01-01") });
  rows("advertiserAccounts").push({ id: ADV, name: "Summit Gear", status: "active", contactPhone: "+13035550199" });
  rows("advertiserMemberships").push(
    { advertiserId: ADV, userId: "u-admin", role: "admin" },
    { advertiserId: ADV, userId: "u-editor", role: "editor" },
  );
});

describe("createAdvertiserAccountAction", () => {
  beforeEach(() => {
    // Start from a user with no advertiser, so every row asserted is this action's.
    h.fake!.tables.delete("advertiserAccounts");
    h.fake!.tables.delete("advertiserMemberships");
  });

  it("creates an active account with the verified phone and makes the creator its admin", async () => {
    const res = await createAdvertiserAccountAction(null, accountForm());
    expect(res.ok).toBe(true);
    const id = res.ok ? res.advertiserId : "";
    expect(rows("advertiserAccounts")).toEqual([
      expect.objectContaining({ id, name: "Summit Gear", contactName: "Pat Doe", contactEmail: "pat@summit.example", contactPhone: "+13035550100", websiteUrl: "https://summit.example", createdByUserId: "u-admin", status: "active" }),
    ]);
    expect(rows("advertiserMemberships")).toEqual([{ advertiserId: id, userId: "u-admin", role: "admin" }]);
    // The phone gate sees the raw number and is bound to this user's proof.
    expect(h.phoneCheck).toHaveBeenCalledWith("303-555-0100", undefined, { token: undefined, userId: "u-admin" });
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.create.success", advertiserId: id }));
  });

  it("refuses a signed-out or MFA-pending actor, a missing user and an unverified email, writing nothing", async () => {
    h.actor = { ok: false, error: "You must be signed in." };
    expect(await createAdvertiserAccountAction(null, accountForm())).toEqual({ ok: false, error: "You must be signed in." });
    h.actor = { ok: true, userId: "u-ghost" };
    expect(await createAdvertiserAccountAction(null, accountForm())).toMatchObject({ ok: false, error: expect.stringMatching(/could not be found/) });
    rows("users").push({ id: "u-new", emailVerified: null });
    h.actor = { ok: true, userId: "u-new" };
    expect(await createAdvertiserAccountAction(null, accountForm())).toMatchObject({ ok: false, error: expect.stringMatching(/Verify your email/) });
    expect(rows("advertiserAccounts")).toEqual([]);
    expect(h.phoneCheck).not.toHaveBeenCalled();
  });

  it("returns field errors for invalid input before checking the phone or writing", async () => {
    const f = accountForm({ name: " ", contactEmail: "not-an-email", websiteUrl: "summit.example" });
    f.delete("tosAccepted");
    const res = await createAdvertiserAccountAction(null, f);
    expect(res).toMatchObject({
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { name: expect.any(Array), contactEmail: expect.any(Array), websiteUrl: expect.any(Array), tosAccepted: expect.any(Array) },
    });
    expect(h.phoneCheck).not.toHaveBeenCalled();
    expect(rows("advertiserAccounts")).toEqual([]);
  });

  it("passes a failed phone verification through as a field error, writing nothing", async () => {
    h.phoneGate = { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { phoneCode: ["That code didn't match or expired."] } };
    expect(await createAdvertiserAccountAction(null, accountForm({ phoneCode: "000000" }))).toEqual({
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: { phoneCode: ["That code didn't match or expired."] },
    });
    expect(rows("advertiserAccounts")).toEqual([]);
  });

  it("turns a phone already used by another advertiser into a logged field error", async () => {
    rows("advertiserAccounts").push({ id: "adv-other", contactPhone: "+13035550100" });
    const res = await createAdvertiserAccountAction(null, accountForm());
    expect(res).toMatchObject({ ok: false, fieldErrors: { contactPhone: [expect.stringMatching(/already registered/)] } });
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.create.phone_in_use", userId: "u-admin" }));
    expect(rows("advertiserAccounts").map((r) => r.id)).toEqual(["adv-other"]);
    expect(rows("advertiserMemberships")).toEqual([]);
  });

  it("rolls the account back and fails loud when the admin membership can't be written", async () => {
    h.failInsert = "advertiserMemberships";
    const res = await createAdvertiserAccountAction(null, accountForm());
    expect(res).toEqual({ ok: false, error: "Couldn't create the advertiser account. Try again in a moment." });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.create.tx_failed", err: expect.any(Error) }));
    // No orphan account without an admin.
    expect(rows("advertiserAccounts")).toEqual([]);
  });
});

describe("createAdvertiserInvitationAction", () => {
  it("stores only the token's hash, emails the link and returns it for copying", async () => {
    const before = Date.now();
    const res = await createAdvertiserInvitationAction(ADV, null, fd({ email: " Sam@Example.ORG ", role: "editor" }));
    expect(res).toMatchObject({ ok: true, email: "sam@example.org", inviteUrl: expect.stringMatching(/^https:\/\/app\.example\.test\/advertiser-invite\/[0-9a-f]{64}$/) });
    const token = res.ok ? res.inviteUrl.split("/advertiser-invite/")[1]! : "";
    const [row] = rows("advertiserInvitations");
    expect(row).toMatchObject({ advertiserId: ADV, email: "sam@example.org", role: "editor", tokenHash: sha256(token), createdByUserId: "u-admin", acceptedAt: null });
    // The plaintext token is never persisted.
    expect(Object.values(row!)).not.toContain(token);
    const ttl = (row!.expiresAt as Date).getTime() - before;
    expect(ttl).toBeGreaterThan(13.9 * 864e5);
    expect(ttl).toBeLessThanOrEqual(14 * 864e5 + 1000);
    expect(h.sendInvite).toHaveBeenCalledWith("sam@example.org", { advertiserName: "Summit Gear", inviteUrl: res.ok ? res.inviteUrl : "", role: "editor" });
    expect(h.revalidate).toHaveBeenCalledWith(`/advertiser/${ADV}/members`);
  });

  it("supersedes a pending invite to the same email but keeps accepted history", async () => {
    rows("advertiserInvitations").push({ id: "old-accepted", advertiserId: ADV, email: "sam@example.org", tokenHash: "x", acceptedAt: new Date() });
    const first = await invite("sam@example.org");
    const second = await invite("sam@example.org", "admin");
    expect(rows("advertiserInvitations").map((r) => r.tokenHash)).toEqual(["x", sha256(second)]);
    asUser("u-sam", "sam@example.org");
    expect(await acceptAdvertiserInvitationAction(first, null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/invalid, already used, or has expired/) });
  });

  it("refuses signed-out actors, editors, non-members and suspended or missing accounts, writing nothing", async () => {
    const f = fd({ email: "sam@example.org", role: "editor" });
    h.actor = { ok: false, error: "You must be signed in." };
    expect(await createAdvertiserInvitationAction(ADV, null, f)).toEqual({ ok: false, error: "You must be signed in." });
    for (const userId of ["u-editor", "u-stranger"]) {
      h.actor = { ok: true, userId };
      expect(await createAdvertiserInvitationAction(ADV, null, f)).toEqual({ ok: false, error: "Only an advertiser admin can invite members." });
    }
    h.actor = { ok: true, userId: "u-admin" };
    // An admin of one advertiser can't invite into another.
    expect(await createAdvertiserInvitationAction("adv-2", null, f)).toMatchObject({ ok: false });
    rows("advertiserAccounts")[0]!.status = "suspended";
    expect(await createAdvertiserInvitationAction(ADV, null, f)).toMatchObject({ ok: false, error: expect.stringMatching(/suspended/) });
    h.fake!.tables.delete("advertiserAccounts");
    expect(await createAdvertiserInvitationAction(ADV, null, f)).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    expect(rows("advertiserInvitations")).toEqual([]);
    expect(h.sendInvite).not.toHaveBeenCalled();
  });

  it("rejects a bad email or role with field errors and leaves a pending invite alone", async () => {
    await invite("sam@example.org");
    h.sendInvite.mockClear();
    const res = await createAdvertiserInvitationAction(ADV, null, fd({ email: "sam@", role: "owner" }));
    expect(res).toMatchObject({ ok: false, error: "Please fix the highlighted fields.", fieldErrors: { email: expect.any(Array), role: expect.any(Array) } });
    expect(rows("advertiserInvitations")).toHaveLength(1);
    expect(h.sendInvite).not.toHaveBeenCalled();
  });

  it("keeps the invite and returns the link when the email can't be sent, logging the failure", async () => {
    h.sendInvite.mockRejectedValue(new Error("resend down"));
    const res = await createAdvertiserInvitationAction(ADV, null, fd({ email: "sam@example.org", role: "editor" }));
    expect(res).toMatchObject({ ok: true, inviteUrl: expect.stringContaining("/advertiser-invite/") });
    expect(rows("advertiserInvitations")).toHaveLength(1);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.invite.email_failed", advertiserId: ADV, err: expect.any(Error) }));
  });

  it("propagates a failed invitation write instead of returning a link that doesn't work", async () => {
    h.failInsert = "advertiserInvitations";
    await expect(createAdvertiserInvitationAction(ADV, null, fd({ email: "sam@example.org", role: "editor" }))).rejects.toThrow(/insert failed/);
    expect(h.sendInvite).not.toHaveBeenCalled();
  });
});

describe("acceptAdvertiserInvitationAction", () => {
  it("joins the signed-in invitee with the invited role and marks the invite used", async () => {
    const token = await invite("sam@example.org", "admin");
    asUser("u-sam", "sam@example.org");
    expect(await acceptAdvertiserInvitationAction(token, null, new FormData())).toEqual({ ok: true, advertiserId: ADV });
    expect(rows("advertiserMemberships")).toContainEqual({ advertiserId: ADV, userId: "u-sam", role: "admin", invitedByUserId: "u-admin" });
    expect(rows("advertiserInvitations")[0]).toMatchObject({ acceptedAt: expect.any(Date), acceptedByUserId: "u-sam" });
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.invite.accepted", advertiserId: ADV, userId: "u-sam" }));
  });

  it("asks a signed-out visitor to sign in, without reading the invitation", async () => {
    const token = await invite("sam@example.org");
    expect(await acceptAdvertiserInvitationAction(token, null, new FormData())).toEqual({ ok: false, error: "Sign in or create an account, then open this link to accept." });
    expect(rows("advertiserInvitations")[0]).toMatchObject({ acceptedAt: null });
  });

  it("looks the token up by hash only: the stored hash itself is not a usable token", async () => {
    await invite("sam@example.org");
    asUser("u-sam", "sam@example.org");
    const storedHash = String(rows("advertiserInvitations")[0]!.tokenHash);
    for (const t of [storedHash, "", "not-a-token"]) {
      expect(await acceptAdvertiserInvitationAction(t, null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/invalid/) });
    }
    expect(rows("advertiserMemberships").map((r) => r.userId)).not.toContain("u-sam");
  });

  it("is single use and refuses an expired link", async () => {
    const token = await invite("sam@example.org");
    asUser("u-sam", "sam@example.org");
    expect((await acceptAdvertiserInvitationAction(token, null, new FormData())).ok).toBe(true);
    asUser("u-other", "other@example.org");
    expect(await acceptAdvertiserInvitationAction(token, null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/already used/) });

    const late = await invite("lee@example.org");
    rows("advertiserInvitations").find((r) => r.email === "lee@example.org")!.expiresAt = new Date(Date.now() - 1000);
    asUser("u-lee", "lee@example.org");
    expect(await acceptAdvertiserInvitationAction(late, null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(rows("advertiserMemberships").map((r) => r.userId)).not.toContain("u-other");
    expect(rows("advertiserMemberships").map((r) => r.userId)).not.toContain("u-lee");
  });

  it("keeps an existing member's role rather than overwriting it from the invite", async () => {
    const token = await invite("ed@example.org", "admin");
    asUser("u-editor", "ed@example.org");
    expect((await acceptAdvertiserInvitationAction(token, null, new FormData())).ok).toBe(true);
    expect(rows("advertiserMemberships").filter((r) => r.userId === "u-editor")).toEqual([{ advertiserId: ADV, userId: "u-editor", role: "editor" }]);
  });

  it("fails loud and leaves the invite usable when the membership write fails", async () => {
    const token = await invite("sam@example.org");
    asUser("u-sam", "sam@example.org");
    h.failInsert = "advertiserMemberships";
    expect(await acceptAdvertiserInvitationAction(token, null, new FormData())).toEqual({ ok: false, error: "Couldn't accept the invitation. Try again in a moment." });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "advertiser.invite.accept_failed", userId: "u-sam", err: expect.any(Error) }));
    expect(rows("advertiserInvitations")[0]).toMatchObject({ acceptedAt: null });
    h.failInsert = null;
    expect((await acceptAdvertiserInvitationAction(token, null, new FormData())).ok).toBe(true);
  });

  // As with /invite and /admin-invite: a forwarded or leaked link must not
  // enroll whoever opens it.
  it("refuses a signed-in user whose email isn't the invited one", async () => {
    const token = await invite("sam@example.org", "admin");
    asUser("u-mallory", "mallory@example.org");
    expect(await acceptAdvertiserInvitationAction(token, null, new FormData())).toMatchObject({ ok: false, error: expect.stringMatching(/issued to sam@example\.org/) });
    expect(rows("advertiserMemberships").map((r) => r.userId)).not.toContain("u-mallory");
  });

  // The guarded claim (acceptedAt IS NULL ... RETURNING) runs first, so an
  // accept that lands between another's read and write grants nothing.
  it("grants one membership when two accepts race on the same link", async () => {
    const token = await invite("sam@example.org", "admin");
    h.beforeTx = async () => {
      asUser("u-sam", "sam@example.org");
      await acceptAdvertiserInvitationAction(token, null, new FormData());
      asUser("u-second", "sam@example.org");
    };
    asUser("u-second", "sam@example.org");
    const loser = await acceptAdvertiserInvitationAction(token, null, new FormData());
    expect(loser).toMatchObject({ ok: false });
    expect(rows("advertiserMemberships").map((r) => r.userId)).not.toContain("u-second");
  });
});
