import { beforeEach, describe, expect, it, vi } from "vitest";

// Controllable rows + a select-call counter so the two db.select() sites (account
// lookup, then admin lookup) resolve to the right data by call order.
const h = vi.hoisted(() => ({
  account: [{ email: "submitter@sar.org", emailVerified: new Date() }] as Array<{
    email: string;
    emailVerified: Date | null;
  }>,
  admins: [{ email: "admin@rmdig.ai" }] as Array<{ email: string }>,
  orgRow: [{ id: "org-1" }] as Array<{ id: string }>,
  selectN: 0,
}));

vi.mock("@/lib/db", () => {
  const makeSelectChain = () => {
    const idx = h.selectN++;
    const result = () => Promise.resolve(idx === 0 ? h.account : h.admins);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      limit: () => result(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
    };
    return chain;
  };
  const tx = {
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(h.orgRow),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(undefined).then(res, rej),
      }),
    }),
  };
  return {
    db: {
      select: () => makeSelectChain(),
      transaction: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// Keep the real RegionPolygonSchema (the schema validates the region with it);
// only stub the DB-touching write helper.
vi.mock("@/lib/sar/geo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sar/geo")>()),
  setRegionGeom: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/blob/upload", () => {
  class ProofDocError extends Error {}
  return {
    ProofDocError,
    uploadProofDoc: vi.fn(() => Promise.resolve({ url: "https://blob.example/proof.pdf" })),
  };
});
vi.mock("@/lib/email/send", () => ({
  sendSarOrgSubmittedEmail: vi.fn(() => Promise.resolve()),
  sendSarOrgPendingReviewEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { auth } from "@/lib/auth";
import { uploadProofDoc } from "@/lib/blob/upload";
import { sendSarOrgPendingReviewEmail, sendSarOrgSubmittedEmail } from "@/lib/email/send";
import { setRegionGeom } from "@/lib/sar/geo";

import { createSarOrgAction } from "@/app/(portal)/sar/new/actions";

const authMock = vi.mocked(auth);

function validFormData(): FormData {
  const fd = new FormData();
  fd.set("name", "San Juan County SAR");
  fd.set("contactName", "Jane Doe");
  fd.set("contactEmail", "jane@sar.org");
  fd.set("operatingStatus", "county_sar");
  fd.set(
    "region",
    JSON.stringify({
      type: "Polygon",
      coordinates: [
        [
          [-108, 37],
          [-107, 37],
          [-107, 38],
          [-108, 38],
          [-108, 37],
        ],
      ],
    }),
  );
  fd.set("tosAccepted", "on");
  fd.set("proofDoc", new File([new Uint8Array([1, 2, 3])], "proof.pdf", { type: "application/pdf" }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selectN = 0;
  h.account = [{ email: "submitter@sar.org", emailVerified: new Date() }];
  h.admins = [{ email: "admin@rmdig.ai" }];
  h.orgRow = [{ id: "org-1" }];
  // signed-in by default
  authMock.mockResolvedValue({ user: { id: "user-1", email: "submitter@sar.org" } } as never);
});

describe("createSarOrgAction", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await createSarOrgAction(null, validFormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/signed in/i);
  });

  it("rejects a user whose email isn't verified", async () => {
    h.account = [{ email: "submitter@sar.org", emailVerified: null }];
    const res = await createSarOrgAction(null, validFormData());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/verify your email/i);
  });

  it("returns field errors for an invalid submission", async () => {
    const fd = validFormData();
    fd.set("contactEmail", "not-an-email");
    const res = await createSarOrgAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.contactEmail).toBeDefined();
  });

  it("surfaces a bad proof doc as a field error", async () => {
    const fd = validFormData();
    fd.delete("proofDoc"); // no file attached
    const res = await createSarOrgAction(null, fd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.proofDoc).toBeDefined();
    expect(uploadProofDoc).not.toHaveBeenCalled();
  });

  it("persists the org, writes the region, and notifies on success", async () => {
    const res = await createSarOrgAction(null, validFormData());
    expect(res).toEqual({ ok: true, orgId: "org-1" });
    expect(uploadProofDoc).toHaveBeenCalledOnce();
    expect(setRegionGeom).toHaveBeenCalledOnce();
    expect(setRegionGeom).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ type: "Polygon" }),
      expect.anything(),
    );
    expect(sendSarOrgSubmittedEmail).toHaveBeenCalledWith("submitter@sar.org", "San Juan County SAR");
    expect(sendSarOrgPendingReviewEmail).toHaveBeenCalledWith(
      "admin@rmdig.ai",
      expect.objectContaining({ orgName: "San Juan County SAR" }),
    );
  });

  it("still succeeds when a notification email fails", async () => {
    vi.mocked(sendSarOrgSubmittedEmail).mockRejectedValueOnce(new Error("resend down"));
    const res = await createSarOrgAction(null, validFormData());
    expect(res.ok).toBe(true);
  });
});
