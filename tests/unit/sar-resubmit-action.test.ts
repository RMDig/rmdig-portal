import { beforeEach, describe, expect, it, vi } from "vitest";

// Resubmitting a pending SAR application (docs/plans/33): org admins only,
// pending only, area and proof kept unless replaced, a `resubmitted` log row,
// staff emailed; an approved org can never be edited here (CLAUDE.md §0).

const h = vi.hoisted(() => ({
  userId: "admin-1" as string | undefined,
  canManage: true,
  orgRows: [{ status: "pending", submitterEmail: "sub@sar.org" }] as unknown[],
  admins: [{ email: "op@rmdig.ai" }] as unknown[],
  selectN: 0,
  updates: [] as unknown[],
  updateReturns: [{ id: "org-1" }] as unknown[],
  inserts: [] as unknown[],
  txError: null as unknown,
  upload: vi.fn(),
  setRegion: vi.fn(),
  email: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/db", () => {
  const select = () => {
    const idx = h.selectN++;
    const result = () => Promise.resolve(idx === 0 ? h.orgRows : h.admins);
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => result(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    return chain;
  };
  const tx = {
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({
          returning: () => {
            h.updates.push(v);
            return Promise.resolve(h.updateReturns);
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        h.inserts.push(v);
        return Promise.resolve();
      },
    }),
  };
  return {
    db: {
      select,
      transaction: async (cb: (t: typeof tx) => unknown) => {
        if (h.txError) throw h.txError;
        return cb(tx);
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
vi.mock("@/lib/auth/org-roles", () => ({ canManageOrg: () => Promise.resolve(h.canManage) }));
vi.mock("@/lib/blob/upload", () => {
  class ProofDocError extends Error {}
  return { ProofDocError, uploadProofDoc: h.upload };
});
vi.mock("@/lib/sar/geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sar/geo")>()),
  setRegionGeom: h.setRegion,
}));
vi.mock("@/lib/email/send", () => ({ sendSarOrgPendingReviewEmail: h.email }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

import { updateSarOrgAction } from "@/app/(portal)/sar/[orgId]/edit/actions";

const ORG = "11111111-1111-4111-8111-111111111111";
const square = { type: "Polygon", coordinates: [[[-108, 37], [-107, 37], [-107, 38], [-108, 37]]] };

function form(extra: Record<string, string | File> = {}): FormData {
  const f = new FormData();
  const fields: Record<string, string | File> = {
    orgType: "ski_patrol",
    name: "Summit Patrol",
    contactName: "Pat",
    contactEmail: "pat@ski.example",
    operatingStatus: "nonprofit",
    region: "",
    proofDoc: new File([], ""),
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "admin-1";
  h.canManage = true;
  h.orgRows = [{ status: "pending", submitterEmail: "sub@sar.org" }];
  h.admins = [{ email: "op@rmdig.ai" }];
  h.selectN = 0;
  h.updates = [];
  h.updateReturns = [{ id: ORG }];
  h.inserts = [];
  h.txError = null;
  h.upload.mockResolvedValue({ url: "https://abc.private.blob.vercel-storage.com/sar-proofs/new.pdf" });
});

describe("updateSarOrgAction", () => {
  it("saves the edit, keeps area and proof, logs `resubmitted`, clears the note and emails staff", async () => {
    await expect(updateSarOrgAction(ORG, null, form())).resolves.toEqual({ ok: true });
    expect(h.updates[0]).toMatchObject({ orgType: "ski_patrol", name: "Summit Patrol", reviewNote: null });
    expect(h.updates[0]).not.toHaveProperty("proofDocUrl");
    expect(h.setRegion).not.toHaveBeenCalled();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.inserts[0]).toMatchObject({ orgId: ORG, action: "resubmitted", fromStatus: "pending", toStatus: "pending", actorUserId: "admin-1" });
    expect(h.email).toHaveBeenCalledWith("op@rmdig.ai", expect.objectContaining({ orgName: "Summit Patrol", submitterEmail: "sub@sar.org" }));
  });

  it("replaces the area and the document when provided", async () => {
    const file = new File([new Uint8Array([1])], "new.pdf", { type: "application/pdf" });
    await updateSarOrgAction(ORG, null, form({ region: JSON.stringify(square), proofDoc: file }));
    expect(h.setRegion).toHaveBeenCalledWith(ORG, square, expect.anything());
    expect(h.updates[0]).toMatchObject({ proofDocUrl: "https://abc.private.blob.vercel-storage.com/sar-proofs/new.pdf" });
  });

  it("refuses signed-out users and anyone who isn't the org's admin", async () => {
    h.userId = undefined;
    expect(await updateSarOrgAction(ORG, null, form())).toMatchObject({ ok: false });
    h.userId = "member-1";
    h.canManage = false;
    expect(await updateSarOrgAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/admins/) });
    expect(h.updates).toEqual([]);
  });

  it("never edits an approved org (§0)", async () => {
    h.orgRows = [{ status: "approved", submitterEmail: "sub@sar.org" }];
    expect(await updateSarOrgAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/under review/) });
    expect(h.updates).toEqual([]);
  });

  it("reports a decision that landed mid-edit instead of overwriting it", async () => {
    h.updateReturns = [];
    expect(await updateSarOrgAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/decided while you were editing/) });
    expect(h.inserts).toEqual([]);
  });

  it("returns field errors and fails loud on a database error", async () => {
    const bad = await updateSarOrgAction(ORG, null, form({ contactEmail: "nope" }));
    expect(bad).toMatchObject({ ok: false, fieldErrors: { contactEmail: expect.any(Array) } });
    h.selectN = 0;
    h.txError = new Error("connection reset");
    expect(await updateSarOrgAction(ORG, null, form())).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't save/) });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.resubmit.tx_failed" }));
  });
});
