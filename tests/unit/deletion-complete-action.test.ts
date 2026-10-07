import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "staff-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  updated: [{ id: "r1" }] as unknown[],
  sets: [] as Array<Record<string, unknown>>,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: () => Promise.resolve(h.admin) }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/avserv/share-log", () => ({ readShareLog: vi.fn() }));
vi.mock("@/lib/avserv/account-lookup", () => ({ lookupAccountsByEmail: vi.fn(), mergeAccountMatches: vi.fn() }));
vi.mock("@/lib/avserv/sar-teams", () => ({ avservNodes: () => [] }));
vi.mock("@/lib/db", () => {
  const sel: Record<string, unknown> = {};
  sel.from = () => sel;
  sel.where = () => sel;
  sel.limit = () => Promise.resolve([{ email: "ops@rmdig.ai" }]);
  return {
    db: {
      select: () => sel,
      update: () => ({
        set: (v: Record<string, unknown>) => ({ where: () => ({ returning: () => (h.sets.push(v), Promise.resolve(h.updated)) }) }),
      }),
    },
  };
});

import { markDeletionCompletedAction } from "@/app/(portal)/admin/deletion-requests/actions";

const REQ = "11111111-1111-4111-8111-111111111111";
const fd = (note: string) => {
  const f = new FormData();
  f.set("requestId", REQ);
  f.set("note", note);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.admin = true;
  h.updated = [{ id: "r1" }];
  h.sets = [];
});

describe("markDeletionCompletedAction", () => {
  it("closes a confirmed request with the note, who did it and when", async () => {
    expect(await markDeletionCompletedAction(null, fd("Portal user deleted; AvServ account erased on both nodes."))).toEqual({ ok: true });
    expect(h.sets[0]).toMatchObject({ status: "completed", completedAt: expect.any(Date), note: expect.stringMatching(/erased on both nodes\.\n— ops@rmdig\.ai, \d{4}-/) });
    expect(h.log.info).toHaveBeenCalledWith(expect.objectContaining({ event: "deletion.completed", requestId: REQ, staffId: "staff-1" }));
  });

  it("needs a real note, an rmdig admin, and a request still in the confirmed queue", async () => {
    expect(await markDeletionCompletedAction(null, fd("done"))).toMatchObject({ ok: false, error: expect.stringMatching(/what was erased/) });
    h.admin = false;
    expect(await markDeletionCompletedAction(null, fd("Portal user deleted; AvServ erased."))).toMatchObject({ ok: false, error: expect.stringMatching(/platform administrator/) });
    h.admin = true;
    h.updated = [];
    expect(await markDeletionCompletedAction(null, fd("Portal user deleted; AvServ erased."))).toMatchObject({ ok: false, error: expect.stringMatching(/confirmed queue/) });
  });
});
