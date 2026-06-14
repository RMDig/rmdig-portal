import { beforeEach, describe, expect, it, vi } from "vitest";

// Rows the mocked query chain resolves to. `where()` is both awaitable (for
// getOrgMemberships) and exposes .limit() (for getOrgRole), so one stub serves
// both query shapes.
const h = vi.hoisted(() => ({ rows: [] as Array<{ orgId?: string; role?: string }> }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const wp = Promise.resolve(h.rows);
          return Object.assign(wp, { limit: () => Promise.resolve(h.rows) });
        },
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  orgMemberships: { orgId: "org_id", userId: "user_id", role: "role" },
}));

import {
  canManageOrg,
  canRespondForOrg,
  getOrgMemberships,
  getOrgRole,
} from "@/lib/auth/org-roles";

beforeEach(() => {
  h.rows = [];
});

describe("org membership helpers", () => {
  it("returns an empty membership list for a user in no orgs", async () => {
    expect(await getOrgMemberships("u1")).toEqual([]);
  });

  it("returns the user's orgs with roles", async () => {
    h.rows = [
      { orgId: "org-a", role: "admin" },
      { orgId: "org-b", role: "responder" },
    ];
    expect(await getOrgMemberships("u1")).toEqual([
      { orgId: "org-a", role: "admin" },
      { orgId: "org-b", role: "responder" },
    ]);
  });

  it("returns null role for a non-member", async () => {
    expect(await getOrgRole("u1", "org-a")).toBeNull();
  });

  it("returns the role for a member", async () => {
    h.rows = [{ role: "dispatcher" }];
    expect(await getOrgRole("u1", "org-a")).toBe("dispatcher");
  });

  it("canManageOrg is true only for admins", async () => {
    h.rows = [{ role: "admin" }];
    expect(await canManageOrg("u1", "org-a")).toBe(true);

    h.rows = [{ role: "dispatcher" }];
    expect(await canManageOrg("u1", "org-a")).toBe(false);

    h.rows = [];
    expect(await canManageOrg("u1", "org-a")).toBe(false);
  });

  it("canRespondForOrg is true for any membership role", async () => {
    for (const role of ["admin", "dispatcher", "responder"]) {
      h.rows = [{ role }];
      expect(await canRespondForOrg("u1", "org-a")).toBe(true);
    }
    h.rows = [];
    expect(await canRespondForOrg("u1", "org-a")).toBe(false);
  });
});
