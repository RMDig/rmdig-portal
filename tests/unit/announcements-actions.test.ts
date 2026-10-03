import { beforeEach, describe, expect, it, vi } from "vitest";

// Staff announcement actions: rmdig_admin only, validated, and every change
// lands in announcement_log in the same transaction.

const h = vi.hoisted(() => ({
  sessionUserId: "admin-1" as string | undefined,
  isAdmin: true,
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  updates: [] as unknown[],
  updateReturns: [{ id: "a1" }] as unknown[],
  insertError: null as unknown,
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fakeDb = vi.hoisted(() => {
  const db = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (h.insertError) throw h.insertError;
        h.inserts.push({ table, values });
        return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ id: "a1" }]) });
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            h.updates.push(values);
            return Promise.resolve(h.updateReturns);
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
  };
  return db;
});

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(h.sessionUserId ? { user: { id: h.sessionUserId } } : null),
}));
vi.mock("@/lib/auth/roles", () => ({
  hasPlatformRole: (_id: string, role: string) => Promise.resolve(role === "rmdig_admin" && h.isAdmin),
}));
vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

import { createAnnouncementAction, endAnnouncementAction } from "@/app/(portal)/admin/announcements/actions";
import { announcementLog, announcements } from "@/lib/db/schema";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const VALID: Array<[string, string]> = [
  ["message", "Portal maintenance Saturday 02:00–02:30 MT."],
  ["severity", "maintenance"],
  ["audiences", "sar"],
  ["audiences", "advertiser"],
  ["startsAt", "2026-10-04T02:00"],
  ["endsAt", "2026-10-04T02:30"],
];
const ID = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "admin-1";
  h.isAdmin = true;
  h.inserts = [];
  h.updates = [];
  h.updateReturns = [{ id: ID }];
  h.insertError = null;
});

describe("createAnnouncementAction", () => {
  it("saves the announcement and its log row, with times converted from Mountain time", async () => {
    await expect(createAnnouncementAction(null, form(VALID))).resolves.toEqual({ ok: true });
    expect(h.inserts.map((i) => i.table)).toEqual([announcements, announcementLog]);
    expect(h.inserts[0]!.values).toMatchObject({
      severity: "maintenance",
      audiences: ["sar", "advertiser"],
      startsAt: new Date("2026-10-04T08:00:00Z"),
      endsAt: new Date("2026-10-04T08:30:00Z"),
      createdByUserId: "admin-1",
    });
    expect(h.inserts[1]!.values).toEqual({ announcementId: "a1", action: "created", actorUserId: "admin-1" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/announcements");
  });

  it("refuses anyone who isn't rmdig_admin, including reviewers and signed-out visitors", async () => {
    h.isAdmin = false;
    expect(await createAnnouncementAction(null, form(VALID))).toMatchObject({ ok: false });
    h.sessionUserId = undefined;
    expect(await createAnnouncementAction(null, form(VALID))).toMatchObject({ ok: false });
    expect(h.inserts).toEqual([]);
  });

  it("returns field errors for a forbidden claim and writes nothing", async () => {
    const res = await createAnnouncementAction(null, form([...VALID.filter(([k]) => k !== "message"), ["message", "We're up 24/7."]]));
    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? undefined : res.fieldErrors?.message?.[0]).toMatch(/claims we can't make/);
    expect(h.inserts).toEqual([]);
  });

  it("fails loud when the database write fails", async () => {
    h.insertError = new Error("connection reset");
    expect(await createAnnouncementAction(null, form(VALID))).toEqual({
      ok: false,
      error: "Couldn't save the announcement. Try again.",
    });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "announcements.create_failed" }));
  });
});

describe("endAnnouncementAction", () => {
  it("ends a live announcement and logs it", async () => {
    await endAnnouncementAction(form([["id", ID]]));
    expect(h.updates[0]).toMatchObject({ endedAt: expect.any(Date) });
    expect(h.inserts[0]!.values).toEqual({ announcementId: ID, action: "ended", actorUserId: "admin-1" });
  });

  it("writes no log row when it was already ended", async () => {
    h.updateReturns = [];
    await endAnnouncementAction(form([["id", ID]]));
    expect(h.inserts).toEqual([]);
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "announcements.end_noop" }));
  });

  it("refuses non-admins and malformed ids", async () => {
    h.isAdmin = false;
    await expect(endAnnouncementAction(form([["id", ID]]))).rejects.toThrow(/administrator/);
    h.isAdmin = true;
    await expect(endAnnouncementAction(form([["id", "nope"]]))).rejects.toThrow(/Unknown/);
    expect(h.updates).toEqual([]);
  });
});
