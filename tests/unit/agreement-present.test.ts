import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertPinnable, present, sha256Hex } from "@/lib/agreement/present";
import type { PinnedAgreement } from "@/lib/agreement/types";

// Hashes are computed from the exact strings rendered (contract
// account_agreement.md rev 2 §2), never stored.

const PIN: PinnedAgreement = {
  version: "v1",
  text: "# Terms\n\nBody.\n",
  assent: { text: "I have read and agree." },
  attestations: [{ id: "age_18_plus", text: "I am 18 years of age or older.", required: true }],
};

describe("sha256Hex", () => {
  it("is lowercase hex sha256 of the UTF-8 bytes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // A non-ASCII string hashes its UTF-8 encoding (0xC3 0xA9), not UTF-16.
    expect(sha256Hex(String.fromCodePoint(0xe9))).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });
});

describe("present", () => {
  it("computes the content, assent and attestation hashes from the strings", () => {
    const p = present(PIN);
    expect(p.contentHash).toBe(sha256Hex(PIN.text));
    expect(p.assent.textHash).toBe(sha256Hex(PIN.assent.text));
    expect(p.attestations[0]).toMatchObject({
      id: "age_18_plus",
      required: true,
      textHash: sha256Hex(PIN.attestations[0]!.text),
    });
    expect(p.fixture).toBe(false);
  });

  it("refuses text AvServ could not have hashed (CR line endings, BOM)", () => {
    expect(() => assertPinnable("a\r\nb")).toThrow(/CR/);
    expect(() => assertPinnable(String.fromCodePoint(0xfeff) + "a")).toThrow(/BOM/);
    expect(() => assertPinnable("a\nb")).not.toThrow();
  });
});

describe("presentedAgreement (E2E seam)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.E2E_AGREEMENT_FIXTURE;
    delete process.env.AVSERV_BASE_URL;
  });

  it("is null while nothing is pinned and the seam is off", async () => {
    const { presentedAgreement } = await import("@/lib/agreement");
    expect(presentedAgreement()).toBeNull();
  });

  it("serves the labelled fixture only with BOTH the flag and a mock AvServ", async () => {
    process.env.E2E_AGREEMENT_FIXTURE = "1";
    process.env.AVSERV_BASE_URL = "mock://localhost";
    const { presentedAgreement } = await import("@/lib/agreement");
    const p = presentedAgreement();
    expect(p?.fixture).toBe(true);
    expect(p?.text).toMatch(/TEST FIXTURE/);
  });

  it("ignores the flag against a real AvServ", async () => {
    process.env.E2E_AGREEMENT_FIXTURE = "1";
    process.env.AVSERV_BASE_URL = "https://avserv-2.rmdig.ai";
    const { presentedAgreement } = await import("@/lib/agreement");
    expect(presentedAgreement()).toBeNull();
  });
});
