import { beforeEach, describe, expect, it, vi } from "vitest";

// The "we removed this account's password" notice is dismissed by its owner,
// and only by a signed-in owner.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "u1" } as { ok: true; userId: string } | { ok: false; error: string },
  updates: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/db/schema", () => ({ users: { id: "id" } }));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          h.updates.push(vals);
          return Promise.resolve();
        },
      }),
    }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));

import { dismissPasswordClearedNoticeAction } from "@/app/(portal)/dashboard/actions";

beforeEach(() => {
  h.actor = { ok: true, userId: "u1" };
  h.updates = [];
  h.revalidated = [];
});

describe("dismissPasswordClearedNoticeAction", () => {
  it("clears the notice for the signed-in user", async () => {
    expect(await dismissPasswordClearedNoticeAction()).toEqual({ ok: true });
    expect(h.updates).toEqual([{ oauthPasswordClearedAt: null }]);
    expect(h.revalidated).toEqual(["/dashboard"]);
  });

  it("refuses without a signed-in user, and says why", async () => {
    h.actor = { ok: false, error: "You must be signed in." };
    expect(await dismissPasswordClearedNoticeAction()).toEqual({ ok: false, error: "You must be signed in." });
    expect(h.updates).toHaveLength(0);
  });
});
