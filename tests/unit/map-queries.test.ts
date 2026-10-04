import { beforeEach, describe, expect, it, vi } from "vitest";

// /map reads: scoped SQL, re-validated geometry (a drifted row fails loudly),
// and no creative query for a non-advertiser.

const h = vi.hoisted(() => ({ executeRows: [] as unknown[], execute: vi.fn(), select: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    execute: (q: unknown) => {
      h.execute(q);
      return Promise.resolve(h.executeRows);
    },
    select: (...a: unknown[]) => {
      h.select(...a);
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "innerJoin", "where"]) chain[m] = () => chain;
      chain.limit = () => Promise.resolve([]);
      return chain;
    },
  },
}));
vi.mock("@/lib/geo/lookup", () => ({ describeTarget: () => "National (everyone)" }));

import { allOrgRows, memberOrgRows, targetRows } from "@/lib/map/queries";

const geo = JSON.stringify({ type: "Polygon", coordinates: [[[-106, 39], [-105, 39], [-105, 40], [-106, 39]]] });

beforeEach(() => {
  vi.clearAllMocks();
  h.executeRows = [];
});

describe("map queries", () => {
  it("parses member orgs, including one with no area", async () => {
    h.executeRows = [
      { id: "a", name: "A", status: "approved", geojson: geo },
      { id: "b", name: "B", status: "pending", geojson: null },
    ];
    const rows = await memberOrgRows("u1");
    expect(rows[0]!.coordinates?.[0]?.length).toBe(4);
    expect(rows[1]!.coordinates).toBeNull();
  });

  it("fails loudly on malformed stored geometry", async () => {
    h.executeRows = [{ id: "a", name: "A", status: "approved", geojson: JSON.stringify({ type: "Point", coordinates: [0, 0] }) }];
    await expect(allOrgRows()).rejects.toThrow();
  });

  it("scopes member orgs to the user and excludes rejected and withdrawn orgs from the staff list", async () => {
    await memberOrgRows("user-123");
    await allOrgRows();
    const [memberSql, allSql] = h.execute.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(memberSql).toContain("org_memberships");
    expect(memberSql).toContain("user-123");
    expect(allSql).toContain("NOT IN ('rejected', 'withdrawn')");
  });

  it("doesn't query creatives for someone with no advertiser account", async () => {
    await expect(targetRows([])).resolves.toEqual([]);
    expect(h.select).not.toHaveBeenCalled();
  });
});
