import { describe, expect, it } from "vitest";

import {
  type AgreementVersion,
  checkPath,
  diffPinned,
  evaluatePin,
  type NodeAnswer,
} from "@/lib/agreement/pin-check";
import { sha256Hex } from "@/lib/agreement/present";
import type { PinnedAgreement } from "@/lib/agreement/types";

// Every row of docs/plans/31 §6, in both modes.

const PIN: PinnedAgreement = {
  version: "v1",
  text: "# AvAI user agreement\n\nText.\n",
  assent: { text: "I have read and agree to the AvAI user agreement." },
  attestations: [{ id: "age_18_plus", text: "I am 18 years of age or older.", required: true }],
};

function published(overrides: Partial<AgreementVersion> = {}): AgreementVersion {
  return {
    version: PIN.version,
    contentHash: sha256Hex(PIN.text),
    status: "current",
    effectiveAt: "2026-10-01T00:00:00Z",
    text: PIN.text,
    assent: { text: PIN.assent.text, textHash: sha256Hex(PIN.assent.text) },
    attestations: PIN.attestations.map((a) => ({ ...a, textHash: sha256Hex(a.text) })),
    ...overrides,
  };
}

const ok = (body: AgreementVersion, node = "https://a"): NodeAnswer => ({ node, kind: "ok", body });
const http = (status: number, code?: string, node = "https://a"): NodeAnswer => ({
  node,
  kind: "http",
  status,
  code,
});
const down = (node = "https://a"): NodeAnswer => ({ node, kind: "unreachable", message: "ECONNREFUSED" });

describe("checkPath", () => {
  it("asks for the pinned version, or current when nothing is pinned", () => {
    expect(checkPath(PIN)).toBe("/v1/agreement/v1");
    expect(checkPath(null)).toBe("/v1/agreement/current");
  });
});

describe("evaluatePin", () => {
  it("passes when nothing is pinned and nothing is published (today)", () => {
    for (const mode of ["pr", "daily"] as const) {
      expect(evaluatePin(null, [http(404, "agreement_not_published")], mode).outcome).toBe("pass");
    }
  });

  it("warns on PRs but fails daily when AvServ published and nothing is pinned", () => {
    const answers = [ok(published())];
    expect(evaluatePin(null, answers, "pr").outcome).toBe("warn");
    const daily = evaluatePin(null, answers, "daily");
    expect(daily.outcome).toBe("fail");
    expect(daily.messages.join()).toMatch(/agreement:pin v1/);
  });

  it("passes when text, assent and attestations all match a current version", () => {
    expect(evaluatePin(PIN, [ok(published())], "pr").outcome).toBe("pass");
  });

  it("warns when the pinned version matches but is no longer current", () => {
    expect(evaluatePin(PIN, [ok(published({ status: "accepted" }))], "pr").outcome).toBe("warn");
  });

  it("fails on a text hash mismatch", () => {
    const r = evaluatePin(PIN, [ok(published({ contentHash: sha256Hex("other") }))], "pr");
    expect(r.outcome).toBe("fail");
    expect(r.messages.join()).toMatch(/text/);
  });

  it("fails on assent wording drift", () => {
    const r = evaluatePin(PIN, [ok(published({ assent: { text: "x", textHash: sha256Hex("x") } }))], "pr");
    expect(r.outcome).toBe("fail");
    expect(r.messages.join()).toMatch(/assent/);
  });

  it("fails on attestation wording, required-flag or set drift", () => {
    const wording = published({
      attestations: [{ id: "age_18_plus", text: "x", textHash: sha256Hex("x"), required: true }],
    });
    const required = published({
      attestations: PIN.attestations.map((a) => ({ ...a, textHash: sha256Hex(a.text), required: false })),
    });
    const extra = published({
      attestations: [
        ...PIN.attestations.map((a) => ({ ...a, textHash: sha256Hex(a.text) })),
        { id: "resident_us", text: "US", textHash: sha256Hex("US"), required: true },
      ],
    });
    for (const body of [wording, required, extra]) {
      expect(evaluatePin(PIN, [ok(body)], "pr").outcome).toBe("fail");
    }
  });

  it("fails when AvServ does not know the pinned version", () => {
    expect(evaluatePin(PIN, [http(404, "agreement_version_unknown")], "pr").outcome).toBe("fail");
  });

  it("falls through a 503 or an unreachable node to the next answer", () => {
    const answers = [down("https://a"), http(503, "agreement_catalog_invalid", "https://b"), ok(published(), "https://c")];
    const r = evaluatePin(PIN, answers, "daily");
    expect(r.outcome).toBe("pass");
    expect(r.messages.join()).toMatch(/https:\/\/c/);
  });

  it("warns on PRs but fails daily when no node answers authoritatively", () => {
    const answers = [down("https://a"), http(503, undefined, "https://b")];
    expect(evaluatePin(PIN, answers, "pr").outcome).toBe("warn");
    expect(evaluatePin(PIN, answers, "daily").outcome).toBe("fail");
    expect(evaluatePin(null, [], "daily").outcome).toBe("fail");
  });
});

describe("diffPinned", () => {
  it("reports nothing for an identical copy", () => {
    expect(diffPinned(PIN, published())).toEqual([]);
  });
});
