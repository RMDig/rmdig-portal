import { describe, expect, it, vi } from "vitest";

// The proof-document cap is shared by the browser check and the server's, and
// must stay under next.config's server-action body limit: over that limit
// Next.js refuses the request before the action runs and the applicant gets the
// error page instead of a field error (2026-10-08).

vi.mock("@/lib/env", () => ({ env: {} }));

import { PROOF_DOC_ACCEPT, PROOF_DOC_MAX_BYTES, proofDocProblem } from "@/lib/blob/proof-limits";
import nextConfig from "@/next.config";

const MB = 1024 * 1024;

function bytes(limit: string): number {
  const match = /^(\d+(?:\.\d+)?)(kb|mb)$/i.exec(limit);
  if (!match) throw new Error(`unexpected size limit "${limit}"`);
  return Number(match[1]) * (match[2]!.toLowerCase() === "mb" ? MB : 1024);
}

describe("proofDocProblem", () => {
  it("accepts a PDF, PNG or JPG at or under 4 MB", () => {
    expect(proofDocProblem({ size: 200 * 1024, type: "application/pdf" })).toBeNull();
    expect(proofDocProblem({ size: PROOF_DOC_MAX_BYTES, type: "image/jpeg" })).toBeNull();
    expect(proofDocProblem({ size: 1, type: "image/png" })).toBeNull();
  });

  it("rejects a file over 4 MB with its size and a hint", () => {
    const problem = proofDocProblem({ size: 6.3 * MB, type: "application/pdf" });
    expect(problem).toMatch(/6\.3 MB/);
    expect(problem).toMatch(/4 MB or smaller/);
    expect(problem).toMatch(/smaller size|lower resolution/);
  });

  it("rejects an empty file and other types", () => {
    expect(proofDocProblem({ size: 0, type: "application/pdf" })).toMatch(/attach/i);
    expect(proofDocProblem({ size: 1000, type: "image/heic" })).toMatch(/PDF, PNG, or JPG/);
  });

  it("offers the browser exactly the accepted types", () => {
    expect(PROOF_DOC_ACCEPT).toBe("application/pdf,image/png,image/jpeg");
  });
});

describe("the server-action body limit", () => {
  it("fits a maximum-size document plus the rest of the form, within Vercel's 4.5 MB", () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit;
    expect(typeof limit).toBe("string");
    const limitBytes = bytes(limit as string);
    expect(limitBytes).toBeGreaterThanOrEqual(PROOF_DOC_MAX_BYTES + 256 * 1024);
    expect(limitBytes).toBeLessThanOrEqual(4.5 * MB);
  });
});
