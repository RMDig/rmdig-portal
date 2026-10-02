import { beforeEach, describe, expect, it, vi } from "vitest";

// SAR proof-doc upload credentials: the Vercel store connection (BLOB_STORE_ID
// + OIDC) wins; a read-write token is the local fallback; neither fails loud.

const h = vi.hoisted(() => ({
  env: {} as { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string },
  put: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("../../lib/env", () => ({ env: h.env }));
vi.mock("@vercel/blob", () => ({ put: h.put }));

import { blobCredentials, uploadProofDoc } from "@/lib/blob/upload";

const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "letter.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.clearAllMocks();
  delete h.env.BLOB_STORE_ID;
  delete h.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.E2E_FAKE_BLOB;
  h.put.mockResolvedValue({ url: "https://blob.example/sar-proofs/x.pdf" });
});

describe("blobCredentials", () => {
  it("uses the connected store (OIDC) when BLOB_STORE_ID is set, even with a token present", () => {
    h.env.BLOB_STORE_ID = "store_abc";
    h.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_x";
    expect(blobCredentials()).toEqual({ storeId: "store_abc" });
  });

  it("falls back to the read-write token for local development", () => {
    h.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_x";
    expect(blobCredentials()).toEqual({ token: "vercel_blob_rw_x" });
  });

  it("fails loud when neither is configured", () => {
    expect(() => blobCredentials()).toThrow(/No Vercel Blob credentials/);
  });
});

describe("uploadProofDoc", () => {
  it("uploads with the store id, public access and an unguessable key", async () => {
    h.env.BLOB_STORE_ID = "store_abc";
    await expect(uploadProofDoc(pdf())).resolves.toEqual({ url: "https://blob.example/sar-proofs/x.pdf" });
    const [key, , opts] = h.put.mock.calls[0]!;
    expect(key).toMatch(/^sar-proofs\/[0-9a-f]{32}\.pdf$/);
    expect(opts).toMatchObject({ access: "public", contentType: "application/pdf", storeId: "store_abc" });
    expect(opts).not.toHaveProperty("token");
  });

  it("refuses before uploading when no credentials exist", async () => {
    await expect(uploadProofDoc(pdf())).rejects.toThrow(/No Vercel Blob credentials/);
    expect(h.put).not.toHaveBeenCalled();
  });
});
