import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AcceptBody } from "@/lib/avserv/agreement";

// The mock:// stand-in must refuse what AvServ refuses, or the E2E gate would
// pass flows production rejects.

const ACCOUNT = "11111111-1111-5111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "mock://localhost";
  process.env.E2E_AGREEMENT_FIXTURE = "1";
});

afterEach(() => {
  delete process.env.E2E_AGREEMENT_FIXTURE;
});

async function setup() {
  const agreement = await import("@/lib/avserv/agreement");
  const { presentedAgreement } = await import("@/lib/agreement");
  const p = presentedAgreement()!;
  const body: AcceptBody = {
    version: p.version,
    contentHash: p.contentHash,
    identity: { legalName: "Jane Q. Public", displayName: "Jane" },
    assent: { method: "checkbox_and_button", textHash: p.assent.textHash, presentedInFull: true },
    attestations: p.attestations.map((a) => ({ id: a.id, textHash: a.textHash, value: true as const })),
    client: { ip: "203.0.113.9", userAgent: "UA", locale: "en-US" },
  };
  return { ...agreement, body };
}

describe("agreement mock", () => {
  it("starts un-activated, activates on accept, and replays the same key", async () => {
    const { getAccount, acceptAgreement, body } = await setup();

    const before = await getAccount(ACCOUNT);
    expect(before.activated).toBe(false);
    expect(before.agreement.needsAcceptance).toBe(true);

    const first = await acceptAgreement(ACCOUNT, KEY, body);
    const again = await acceptAgreement(ACCOUNT, KEY, body);
    expect(again).toEqual(first);

    const after = await getAccount(ACCOUNT);
    expect(after.activated).toBe(true);
    expect(after.acceptances).toHaveLength(1);
    expect(after.agreement.needsAcceptance).toBe(false);
  });

  it("asks for re-acceptance after a legal-name change", async () => {
    const { acceptAgreement, putIdentity, body } = await setup();
    await acceptAgreement(ACCOUNT, KEY, body);

    const changed = await putIdentity(ACCOUNT, { legalName: "Jane Public" });
    expect(changed.activated).toBe(true);
    expect(changed.agreement.needsAcceptance).toBe(true);
  });

  it.each([
    ["a text hash mismatch", (b: AcceptBody) => ({ ...b, contentHash: "0".repeat(64) }), "agreement_hash_mismatch"],
    ["assent wording drift", (b: AcceptBody) => ({ ...b, assent: { ...b.assent, textHash: "0".repeat(64) } }), "agreement_wording_mismatch"],
    ["a missing required attestation", (b: AcceptBody) => ({ ...b, attestations: [] }), "attestation_missing"],
    ["a missing browser IP", (b: AcceptBody) => ({ ...b, client: { ...b.client, ip: "" } }), "invalid_client_ip"],
    ["an invalid alert name", (b: AcceptBody) => ({ ...b, identity: { legalName: "Jane", displayName: "Jane2" } }), "invalid_display_name"],
  ])("refuses %s", async (_label, mutate, code) => {
    const { acceptAgreement, body } = await setup();
    await expect(acceptAgreement(ACCOUNT, KEY, mutate(body))).rejects.toMatchObject({ code });
  });

  it("refuses a reused key for a different version", async () => {
    const { acceptAgreement, body } = await setup();
    await acceptAgreement(ACCOUNT, KEY, body);
    await expect(acceptAgreement(ACCOUNT, KEY, { ...body, version: "v9" })).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("refuses an incomplete identity", async () => {
    const { acceptAgreement, body } = await setup();
    const { identity: _omit, ...noIdentity } = body;
    await expect(
      acceptAgreement("33333333-3333-5333-8333-333333333333", KEY, noIdentity),
    ).rejects.toMatchObject({ status: 422, code: "identity_incomplete" });
  });

  it("answers agreement_not_published while nothing is presented", async () => {
    delete process.env.E2E_AGREEMENT_FIXTURE;
    const { acceptAgreement } = await import("@/lib/avserv/agreement");
    // Only the version matters: the mock refuses before reading the rest.
    const body = { version: "v1" } as AcceptBody;
    await expect(acceptAgreement(ACCOUNT, KEY, body)).rejects.toMatchObject({
      status: 404,
      code: "agreement_not_published",
    });
  });
});
