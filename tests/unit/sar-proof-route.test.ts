import { beforeEach, describe, expect, it, vi } from "vitest";

// /admin/sar-approvals/proof/[orgId]: the only way to open a proof document.
// Staff only (everyone else gets a plain 404), streamed, never cached, logged.

const h = vi.hoisted(() => ({
  userId: "staff-1" as string | undefined,
  staff: true,
  rows: [{ url: "https://abc.private.blob.vercel-storage.com/sar-proofs/x.pdf" }] as unknown[],
  getProofDoc: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: () => Promise.resolve(h.userId ? { user: { id: h.userId } } : null) }));
// h.staff: holds rmdig_sar_approver, the only role that sees proof documents.
vi.mock("@/lib/auth/roles", () => ({ isSarApprover: () => Promise.resolve(h.staff) }));
vi.mock("@/lib/blob/upload", () => ({ getProofDoc: h.getProofDoc }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(h.rows);
  return { db: { select: () => chain } };
});

import { GET } from "@/app/(portal)/admin/sar-approvals/proof/[orgId]/route";

const ORG = "11111111-1111-4111-8111-111111111111";
const call = (orgId = ORG) => GET(new Request("http://x"), { params: Promise.resolve({ orgId }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = "staff-1";
  h.staff = true;
  h.rows = [{ url: "https://abc.private.blob.vercel-storage.com/sar-proofs/x.pdf" }];
  h.getProofDoc.mockResolvedValue({ stream: new ReadableStream(), contentType: "application/pdf" });
});

describe("GET proof document", () => {
  it("streams the document to staff with no-store and nosniff, and logs the view", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(h.log.info).toHaveBeenCalledWith({ event: "sar.proof.viewed", staffId: "staff-1", orgId: ORG });
  });

  it("answers 404 to non-staff and signed-out visitors without reading anything", async () => {
    h.staff = false;
    expect((await call()).status).toBe(404);
    h.userId = undefined;
    expect((await call()).status).toBe(404);
    expect(h.getProofDoc).not.toHaveBeenCalled();
  });

  it("answers 404 for a malformed id, an unknown org, or a missing document", async () => {
    expect((await call("nope")).status).toBe(404);
    h.rows = [];
    expect((await call()).status).toBe(404);
    h.rows = [{ url: "https://abc.private.blob.vercel-storage.com/sar-proofs/x.pdf" }];
    h.getProofDoc.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(h.log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.proof.missing" }));
  });

  it("fails loud when storage errors", async () => {
    h.getProofDoc.mockRejectedValue(new Error("403 from blob"));
    expect((await call()).status).toBe(502);
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "sar.proof.read_failed" }));
  });
});
