import { beforeEach, describe, expect, it, vi } from "vitest";

// An approved team changes its own service area (plan 33 D3, step 9.4;
// CLAUDE.md §0): admins only, approved only, refused when AvServ would refuse
// it, saved with an area-log row in one transaction, then synced and emailed
// to staff. A failed sync or email is surfaced, never rolled back.

const h = vi.hoisted(() => ({
  userId: "admin-1" as string | undefined,
  canManage: true,
  orgRows: [{ name: "Summit SAR", status: "approved", isDrill: false, editorEmail: "lead@sar.org" }] as unknown[],
  lockedStatus: "approved" as string | undefined,
  inserts: [] as unknown[],
  txError: null as unknown,
  assess: vi.fn(),
  setRegion: vi.fn(),
  kmSequence: [] as Array<number | null>,
  sync: vi.fn(),
  staff: vi.fn(),
  email: vi.fn(),
  revalidate: vi.fn(),
  reportError: vi.fn(),
  reportProblem: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "for"]) c[m] = () => c;
    c.limit = () => Promise.resolve(rows());
    return c;
  };
  const tx = {
    select: () => chain(() => (h.lockedStatus ? [{ status: h.lockedStatus }] : [])),
    insert: () => ({ values: (v: unknown) => { h.inserts.push(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      select: () => chain(() => h.orgRows),
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/auth/staff-recipients", () => ({ staffEmails: h.staff }));
vi.mock("@/lib/sar/area-checks", () => ({ assessArea: h.assess }));
vi.mock("@/lib/sar/geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sar/geo")>()),
  setRegionGeom: h.setRegion,
  getRegionAsGeoJson: () => Promise.resolve(OLD),
  getRegionAreaKm2: () => Promise.resolve(h.kmSequence.shift() ?? null),
}));
vi.mock("@/lib/sar/sync", () => ({ syncSarOrg: h.sync }));
vi.mock("@/lib/email/send", () => ({ sendSarAreaChangedEmail: h.email }));
vi.mock("@/lib/report-error", () => ({ reportError: h.reportError, reportProblem: h.reportProblem }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import { saveAreaAction } from "@/app/(portal)/sar/[orgId]/area/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const OLD = { type: "Polygon", coordinates: [[[-106, 39], [-105.9, 39], [-105.9, 39.1], [-106, 39]]] };
const NEW = { type: "Polygon" as const, coordinates: [[[-106, 39], [-105.8, 39], [-105.8, 39.2], [-106, 39]]] };
const form = (region: unknown = NEW) => {
  const f = new FormData();
  f.set("region", typeof region === "string" ? region : JSON.stringify(region));
  return f;
};
const okAssessment = { ok: true, area: NEW, areaKm2: 380, bytes: 100, vertices: 4, overlaps: [], clip: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "admin-1";
  h.canManage = true;
  h.orgRows = [{ name: "Summit SAR", status: "approved", isDrill: false, editorEmail: "lead@sar.org" }];
  h.lockedStatus = "approved";
  h.inserts = [];
  h.txError = null;
  h.kmSequence = [120, 380];
  h.assess.mockResolvedValue(okAssessment);
  h.setRegion.mockResolvedValue(undefined);
  h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "ok" }]);
  h.staff.mockResolvedValue(["op@rmdig.ai"]);
  h.email.mockResolvedValue(undefined);
});

describe("saveAreaAction", () => {
  it("saves the area with a log row of old and new, syncs it and emails staff", async () => {
    expect(await saveAreaAction(ORG, null, form())).toEqual({ ok: true, areaKm2: 380, sync: "sent" });
    expect(h.assess).toHaveBeenCalledWith(NEW, ORG);
    expect(h.setRegion).toHaveBeenCalledWith(ORG, NEW, expect.anything());
    expect(h.inserts).toEqual([{ orgId: ORG, fromArea: OLD, toArea: NEW, fromAreaKm2: 120, toAreaKm2: 380, actorUserId: "admin-1" }]);
    expect(h.sync).toHaveBeenCalledWith(ORG);
    expect(h.email).toHaveBeenCalledWith("op@rmdig.ai", {
      orgName: "Summit SAR",
      editorEmail: "lead@sar.org",
      fromAreaKm2: 120,
      toAreaKm2: 380,
      orgUrl: expect.stringContaining(`/admin/sar-approvals#org-${ORG}`),
      drill: false,
    });
    expect(h.revalidate).toHaveBeenCalledWith(`/sar/${ORG}/area`);
  });

  it("keeps a drill team's limits when it moves: at most 4 km², never over a real team (plan 37 §4.4)", async () => {
    h.orgRows = [{ name: "AvAI Drill Team", status: "approved", isDrill: true, editorEmail: "ops+drill1@rmdig.ai" }];
    h.assess.mockResolvedValue({ ...okAssessment, areaKm2: 9 });
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, fieldErrors: { region: [expect.stringContaining("at most 4 km²")] } });
    h.assess.mockResolvedValue({ ...okAssessment, areaKm2: 2, overlaps: [{ orgId: "r", name: "Real SAR", status: "approved", overlapKm2: 1 }] });
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, fieldErrors: { region: [expect.stringContaining("real team")] } });
    expect(h.setRegion).not.toHaveBeenCalled();
    h.assess.mockResolvedValue({ ...okAssessment, areaKm2: 2 });
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: true });
    // Staff hear about it as a drill, linked to the Drill teams page (plan 37 §4.7).
    expect(h.email).toHaveBeenCalledWith("op@rmdig.ai", expect.objectContaining({ drill: true, orgUrl: expect.stringMatching(/\/admin\/sar-drill$/) }));
  });

  it("puts no drill limit on a real team's area, overlaps included", async () => {
    h.assess.mockResolvedValue({ ...okAssessment, areaKm2: 5000, overlaps: [{ orgId: "r", name: "Other SAR", status: "approved", overlapKm2: 1 }] });
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: true });
  });

  it("refuses someone signed out, or not one of the team's admins", async () => {
    h.userId = undefined;
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false });
    h.userId = "admin-1";
    h.canManage = false;
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/admins/) });
    expect(h.setRegion).not.toHaveBeenCalled();
  });

  it("refuses a team that isn't approved, sending a pending one to resubmit", async () => {
    for (const status of ["pending", "suspended", "leaving", "rejected"]) {
      h.orgRows = [{ name: "Summit SAR", status, editorEmail: "lead@sar.org" }];
      expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/resubmitting/) });
    }
    expect(h.setRegion).not.toHaveBeenCalled();
  });

  it("refuses a missing or unreadable drawing as a field error", async () => {
    expect(await saveAreaAction(ORG, null, form(""))).toMatchObject({ ok: false, fieldErrors: { region: expect.any(Array) } });
    expect(await saveAreaAction(ORG, null, form("{not json"))).toMatchObject({ ok: false, fieldErrors: { region: expect.any(Array) } });
    expect(h.assess).not.toHaveBeenCalled();
  });

  it("refuses an area AvServ would refuse, with the check's own words, and saves nothing", async () => {
    h.assess.mockResolvedValue({ ok: false, code: "area_too_large", message: "The area is 1.20 MiB once simplified; the limit is 1 MiB. Remove about 17% of its points." });
    const r = await saveAreaAction(ORG, null, form());
    expect(r).toEqual({
      ok: false,
      error: expect.stringMatching(/Remove about 17%/),
      fieldErrors: { region: [expect.stringMatching(/Remove about 17%/)] },
    });
    expect(h.setRegion).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("refuses when the team was suspended between loading and saving", async () => {
    h.lockedStatus = "suspended";
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/status changed/) });
    expect(h.setRegion).not.toHaveBeenCalled();
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("fails loud when the check or the save fails", async () => {
    h.assess.mockRejectedValueOnce(new Error("db down"));
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't check/) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.area.assess_failed" }));
    h.txError = new Error("deadlock");
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't save/) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.area.save_failed" }));
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("keeps the saved area when a node doesn't take it, and says so", async () => {
    h.sync.mockResolvedValue([{ node: "avserv-2", outcome: "ok" }, { node: "avserv-3", outcome: "error", code: "timeout" }]);
    expect(await saveAreaAction(ORG, null, form())).toEqual({ ok: true, areaKm2: 380, sync: "partial" });
    expect(h.reportProblem).toHaveBeenCalledWith("sar.area.sync_incomplete", expect.any(String), expect.objectContaining({ orgId: ORG }));
    h.sync.mockRejectedValue(new Error("unknown org"));
    h.kmSequence = [380, 380];
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: true, sync: "partial" });
    expect(h.reportError).toHaveBeenCalledWith("sar.area.sync_failed", expect.any(Error), { orgId: ORG });
    expect(h.email).toHaveBeenCalled();
  });

  it("keeps the saved area when staff can't be emailed, and logs it", async () => {
    h.email.mockRejectedValue(new Error("resend down"));
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: true });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.area.staff_email_failed" }));
    h.staff.mockResolvedValue([]);
    h.kmSequence = [380, 380];
    expect(await saveAreaAction(ORG, null, form())).toMatchObject({ ok: true });
    expect(h.reportProblem).toHaveBeenCalledWith("sar.area.no_staff_to_notify", expect.any(String), { orgId: ORG });
  });
});
