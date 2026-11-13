import { beforeEach, describe, expect, it, vi } from "vitest";

// registerDrillOrgAction (plan 37 §4.3): rmdig_admin only; a drill-named SAR
// team with no proof, a small area that never sits over a real team, a
// verified phone; written pending, logged drill_registered, nobody emailed.

const h = vi.hoisted(() => ({
  actor: { ok: true, userId: "admin-1" } as { ok: true; userId: string } | { ok: false; error: string },
  admin: true,
  assessment: null as unknown,
  phone: { ok: true, phone: "+17205550100" } as { ok: true; phone: string | null } | { ok: false; error: string; fieldErrors: Record<string, string[]> },
  inserted: [] as Array<Record<string, unknown>>,
  txError: null as unknown,
  assess: vi.fn(),
  setRegionGeom: vi.fn(() => Promise.resolve()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth/portal-actor", () => ({ portalActor: () => Promise.resolve(h.actor) }));
vi.mock("@/lib/auth/roles", () => ({ hasPlatformRole: (_u: string, role: string) => Promise.resolve(role === "rmdig_admin" && h.admin) }));
vi.mock("@/lib/phone/org-phone", () => ({ requireVerifiedOrgPhone: () => Promise.resolve(h.phone) }));
vi.mock("@/lib/sar/area-checks", () => ({ assessArea: h.assess }));
vi.mock("@/lib/sar/geo", async (orig) => ({ ...(await orig<typeof import("@/lib/sar/geo")>()), setRegionGeom: h.setRegionGeom }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/db", () => {
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        h.inserted.push(v);
        return { returning: () => Promise.resolve([{ id: "org-drill" }]), then: (r: (x: unknown) => unknown) => Promise.resolve(undefined).then(r) };
      },
    }),
  };
  return {
    db: {
      transaction: (cb: (t: typeof tx) => unknown) => (h.txError ? Promise.reject(h.txError) : Promise.resolve(cb(tx))),
    },
  };
});

import { registerDrillOrgAction } from "@/app/(portal)/admin/sar-drill/new/actions";
import { DRILL_REGISTERED_NOTE } from "@/lib/sar/drill";

const SQUARE = { type: "Polygon", coordinates: [[[-104.99, 39.735], [-104.98, 39.735], [-104.98, 39.743], [-104.99, 39.735]]] };
const ok = (o: Record<string, unknown> = {}) => ({ ok: true, area: SQUARE, areaKm2: 3.1, bytes: 100, vertices: 4, overlaps: [], clip: null, ...o });

function form(o: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const v = { name: "AvAI Drill Team", contactName: "Ops", contactEmail: "ops@rmdig.ai", contactPhone: "+17205550100", region: JSON.stringify(SQUARE), ...o };
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.actor = { ok: true, userId: "admin-1" };
  h.admin = true;
  h.phone = { ok: true, phone: "+17205550100" };
  h.inserted = [];
  h.txError = null;
  h.assess.mockResolvedValue(ok());
});

describe("registerDrillOrgAction", () => {
  it("registers a pending drill team with no proof, logs drill_registered, and adds no member", async () => {
    expect(await registerDrillOrgAction(null, form())).toEqual({ ok: true, orgId: "org-drill" });
    const [org, log] = h.inserted;
    expect(org).toMatchObject({
      orgType: "sar_team",
      name: "AvAI Drill Team",
      isDrill: true,
      proofDocUrl: null,
      contactPhone: "+17205550100",
      createdByUserId: "admin-1",
    });
    expect(log).toMatchObject({ orgId: "org-drill", action: "drill_registered", fromStatus: null, toStatus: "pending", note: DRILL_REGISTERED_NOTE, actorUserId: "admin-1" });
    // Only the org and its log: the registering admin is never a member.
    expect(h.inserted).toHaveLength(2);
    expect(h.setRegionGeom).toHaveBeenCalledWith("org-drill", SQUARE, expect.anything());
  });

  it("refuses anyone who isn't signed in, and anyone who isn't an rmdig admin", async () => {
    h.actor = { ok: false, error: "Sign in again." };
    expect(await registerDrillOrgAction(null, form())).toEqual({ ok: false, error: "Sign in again." });
    h.actor = { ok: true, userId: "approver-1" };
    h.admin = false;
    expect(await registerDrillOrgAction(null, form())).toEqual({ ok: false, error: "Only rmdig admins can register a drill team." });
    expect(h.log.warn).toHaveBeenCalledWith({ event: "sar.drill.register_forbidden", userId: "approver-1" });
    expect(h.inserted).toHaveLength(0);
  });

  it("refuses a name without 'drill', and a missing area", async () => {
    const named = await registerDrillOrgAction(null, form({ name: "Test Team" }));
    expect(named).toMatchObject({ ok: false, fieldErrors: { name: ['A drill team\'s name must contain "drill".'] } });
    const noArea = await registerDrillOrgAction(null, form({ region: "" }));
    expect(noArea).toMatchObject({ ok: false, fieldErrors: { region: [expect.any(String)] } });
    expect(h.assess).not.toHaveBeenCalled();
  });

  it("refuses an area AvServ would refuse, in the check's words", async () => {
    h.assess.mockResolvedValue({ ok: false, code: "area_invalid", message: "The outline is too small." });
    expect(await registerDrillOrgAction(null, form())).toMatchObject({ ok: false, fieldErrors: { region: ["The outline is too small."] } });
    expect(h.inserted).toHaveLength(0);
  });

  it("refuses an area over 4 km², or over a real team's area", async () => {
    h.assess.mockResolvedValue(ok({ areaKm2: 4.5 }));
    const big = await registerDrillOrgAction(null, form());
    expect(big).toMatchObject({ ok: false, error: expect.stringContaining("at most 4 km²") });
    h.assess.mockResolvedValue(ok({ overlaps: [{ orgId: "real-1", name: "Denver SAR", status: "approved", overlapKm2: 0.5 }] }));
    const over = await registerDrillOrgAction(null, form());
    expect(over).toMatchObject({ ok: false, error: expect.stringContaining("can't overlap a real team's") });
    expect(h.inserted).toHaveLength(0);
  });

  it("fails loud when the area check itself fails", async () => {
    h.assess.mockRejectedValue(new Error("db down"));
    expect(await registerDrillOrgAction(null, form())).toEqual({ ok: false, error: "Couldn't check the service area. Try again in a moment." });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.drill.area_check_failed" }));
  });

  it("needs the drill phone verified", async () => {
    h.phone = { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { phoneCode: ["Enter the code."] } };
    expect(await registerDrillOrgAction(null, form())).toMatchObject({ ok: false, fieldErrors: { phoneCode: ["Enter the code."] } });
    expect(h.inserted).toHaveLength(0);
  });

  it("fails loud on a write error", async () => {
    h.txError = new Error("check violation");
    expect(await registerDrillOrgAction(null, form())).toEqual({ ok: false, error: "Couldn't register the drill team. Try again in a moment." });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.drill.register_failed" }));
  });
});
