import { beforeEach, describe, expect, it, vi } from "vitest";

// The check the area editor runs on each new area (plan 33 §6.3, steps
// 9.5–9.6): size, the large-area warning and AvServ's refusals for anyone
// drawing one; other teams' names and the clip only for an approved team's
// admins. Read-only, and loud when the check itself fails.

const h = vi.hoisted(() => ({
  userId: "admin-1" as string | undefined,
  canManage: true,
  orgRows: [{ status: "approved" }] as unknown[],
  assess: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where"]) c[m] = () => c;
  c.limit = () => Promise.resolve(h.orgRows);
  return { db: { select: () => c } };
});
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/sar/area-checks", () => ({ assessArea: h.assess, LARGE_AREA_KM2: 12_361.852647 }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { checkAreaAction } from "@/app/(portal)/sar/area-check-action";

const ORG = "11111111-1111-4111-8111-111111111111";
const NEW = { type: "Polygon" as const, coordinates: [[[-106, 39], [-105.8, 39], [-105.8, 39.2], [-106, 39]]] };
const CLIP = { type: "Polygon" as const, coordinates: [[[-106, 39], [-105.9, 39], [-105.9, 39.2], [-106, 39]]] };
const overlaps = [{ orgId: "o2", name: "Bravo SAR", status: "pending", overlapKm2: 190 }];
const okAssessment = { ok: true, area: NEW, areaKm2: 380, bytes: 100, vertices: 4, overlaps: [], clip: null };
const withOverlap = { ...okAssessment, overlaps, clip: { ok: true, area: CLIP, areaKm2: 190, caps: { ok: true, bytes: 1, vertices: 4 } } };

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "admin-1";
  h.canManage = true;
  h.orgRows = [{ status: "approved" }];
  h.assess.mockResolvedValue(okAssessment);
});

describe("checkAreaAction for an approved team", () => {
  it("reports the size, the teams it overlaps by name only, and the area without them", async () => {
    h.assess.mockResolvedValue(withOverlap);
    expect(await checkAreaAction(ORG, NEW)).toEqual({
      ok: true,
      areaKm2: 380,
      large: null,
      overlaps: [{ name: "Bravo SAR", overlapKm2: 190 }],
      clip: { ok: true, area: CLIP, areaKm2: 190 },
    });
    expect(h.assess).toHaveBeenCalledWith(NEW, ORG);
  });

  it("warns above Colorado's largest county, and not at or below it", async () => {
    h.assess.mockResolvedValue({ ...okAssessment, areaKm2: 12_400 });
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ ok: true, large: { thresholdKm2: 12_361.852647 } });
    h.assess.mockResolvedValue({ ...okAssessment, areaKm2: 12_361.852647 });
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ ok: true, large: null });
  });

  it("explains a clip it can't offer: several pieces, or too big for AvServ", async () => {
    h.assess.mockResolvedValue({ ...okAssessment, overlaps, clip: { ok: false, reason: "multipart", parts: 2, message: "would split this one into 2 pieces" } });
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ clip: { ok: false, message: "would split this one into 2 pieces" } });
    h.assess.mockResolvedValue({
      ...okAssessment,
      overlaps,
      clip: { ok: true, area: CLIP, areaKm2: 190, caps: { ok: false, code: "area_too_large", message: "Remove about 5% of its points.", bytes: 2, vertices: 4 } },
    });
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ clip: { ok: false, message: "Remove about 5% of its points." } });
  });

  it("passes on AvServ's refusal as the error", async () => {
    h.assess.mockResolvedValue({ ok: false, code: "area_invalid", message: "The outline is too small to keep." });
    expect(await checkAreaAction(ORG, NEW)).toEqual({ ok: false, error: "The outline is too small to keep." });
  });
});

describe("checkAreaAction for an applicant", () => {
  it("checks a new application's area for anyone signed in, naming no other team", async () => {
    h.assess.mockResolvedValue({ ...withOverlap, areaKm2: 13_000 });
    expect(await checkAreaAction(null, NEW)).toEqual({ ok: true, areaKm2: 13_000, large: { thresholdKm2: 12_361.852647 }, overlaps: [], clip: null });
    expect(h.assess).toHaveBeenCalledWith(NEW, null);
  });

  it("checks a pending team's resubmit for its admins, naming no other team", async () => {
    h.orgRows = [{ status: "pending" }];
    h.assess.mockResolvedValue(withOverlap);
    expect(await checkAreaAction(ORG, NEW)).toEqual({ ok: true, areaKm2: 380, large: null, overlaps: [], clip: null });
  });

  it("still passes on AvServ's refusal", async () => {
    h.assess.mockResolvedValue({ ok: false, code: "area_too_large", message: "Remove about 17% of its points." });
    expect(await checkAreaAction(null, NEW)).toEqual({ ok: false, error: "Remove about 17% of its points." });
  });
});

describe("checkAreaAction refusals", () => {
  it("refuses someone signed out, a non-admin, a team that's neither pending nor approved, and a bad id", async () => {
    h.userId = undefined;
    expect(await checkAreaAction(null, NEW)).toMatchObject({ ok: false });
    h.userId = "admin-1";
    h.canManage = false;
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ ok: false, error: expect.stringMatching(/admins/) });
    h.canManage = true;
    for (const status of ["suspended", "leaving", "rejected", "withdrawn"]) {
      h.orgRows = [{ status }];
      expect(await checkAreaAction(ORG, NEW)).toMatchObject({ ok: false, error: expect.stringMatching(/can't be changed now/) });
    }
    h.orgRows = [];
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ ok: false });
    expect(await checkAreaAction("not-a-uuid", NEW)).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't be found/) });
    expect(h.assess).not.toHaveBeenCalled();
  });

  it("refuses an unreadable area", async () => {
    expect(await checkAreaAction(ORG, { type: "Polygon", coordinates: "nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't be read/) });
    expect(h.assess).not.toHaveBeenCalled();
  });

  it("fails loud when the check itself fails", async () => {
    h.assess.mockRejectedValue(new Error("db down"));
    expect(await checkAreaAction(ORG, NEW)).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't check/) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.area.check_failed" }));
  });
});
