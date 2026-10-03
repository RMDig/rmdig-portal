import { beforeEach, describe, expect, it, vi } from "vitest";

// SAR proof-doc upload credentials: the Vercel store connection (BLOB_STORE_ID
// + OIDC) wins; a read-write token is the local fallback; neither fails loud.

const h = vi.hoisted(() => ({
  env: {} as { BLOB_STORE_ID?: string; BLOB_READ_WRITE_TOKEN?: string },
  put: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("../../lib/env", () => ({ env: h.env }));
vi.mock("@vercel/blob", () => ({ put: h.put, get: h.get }));

import { blobCredentials, getProofDoc, proofDocAccess, uploadProofDoc } from "@/lib/blob/upload";

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
  it("uploads to the private store with the store id and an unguessable key", async () => {
    h.env.BLOB_STORE_ID = "store_abc";
    await expect(uploadProofDoc(pdf())).resolves.toEqual({ url: "https://blob.example/sar-proofs/x.pdf" });
    const [key, , opts] = h.put.mock.calls[0]!;
    expect(key).toMatch(/^sar-proofs\/[0-9a-f]{32}\.pdf$/);
    expect(opts).toMatchObject({ access: "private", contentType: "application/pdf", storeId: "store_abc" });
    expect(opts).not.toHaveProperty("token");
  });

  it("refuses before uploading when no credentials exist", async () => {
    await expect(uploadProofDoc(pdf())).rejects.toThrow(/No Vercel Blob credentials/);
    expect(h.put).not.toHaveBeenCalled();
  });
});

describe("proof documents are read, never linked", () => {
  const priv = "https://abc123.private.blob.vercel-storage.com/sar-proofs/x.pdf";
  const pub = "https://abc123.public.blob.vercel-storage.com/sar-proofs/x.pdf";

  it("tells private, legacy public and E2E fake URLs apart", () => {
    expect(proofDocAccess(priv)).toBe("private");
    expect(proofDocAccess(pub)).toBe("public");
    expect(proofDocAccess("https://blob.local/sar-proofs/x.pdf")).toBe("fake");
  });

  it("reads a private document with the store credentials", async () => {
    h.env.BLOB_STORE_ID = "store_abc";
    const stream = new ReadableStream();
    h.get.mockResolvedValue({ statusCode: 200, stream, blob: { contentType: "application/pdf" } });
    await expect(getProofDoc(priv)).resolves.toEqual({ stream, contentType: "application/pdf" });
    expect(h.get).toHaveBeenCalledWith(priv, { access: "private", storeId: "store_abc" });
  });

  it("reads a legacy public document without credentials", async () => {
    h.get.mockResolvedValue({ statusCode: 200, stream: new ReadableStream(), blob: { contentType: "image/png" } });
    await getProofDoc(pub);
    expect(h.get).toHaveBeenCalledWith(pub, { access: "public" });
  });

  it("returns null when the document is gone or fake, and fails loud on an unexpected status", async () => {
    h.get.mockResolvedValue(null);
    await expect(getProofDoc(pub)).resolves.toBeNull();
    await expect(getProofDoc("https://blob.local/sar-proofs/x.pdf")).resolves.toBeNull();
    h.env.BLOB_STORE_ID = "store_abc";
    h.get.mockResolvedValue({ statusCode: 304, stream: null, blob: { contentType: null } });
    await expect(getProofDoc(priv)).rejects.toThrow(/304/);
  });
});
