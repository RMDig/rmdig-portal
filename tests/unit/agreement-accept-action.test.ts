import { beforeEach, describe, expect, it, vi } from "vitest";

import { present, type PresentedAgreement } from "@/lib/agreement/present";
import { AgreementError } from "@/lib/avserv/agreement-types";

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  selectRows: [] as Array<{ avservAccountId: string | null }>,
  presented: null as PresentedAgreement | null,
  browserIp: vi.fn(),
  acceptAgreement: vi.fn(),
  rateAllowed: true,
  incrementRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  requestHeaders: {} as Record<string, string>,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(h.sessionUserId ? { user: { id: h.sessionUserId } } : null),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.selectRows) }) }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ users: { id: "id", avservAccountId: "avservAccountId" } }));
vi.mock("@/lib/agreement", () => ({ presentedAgreement: () => h.presented }));
vi.mock("@/lib/avserv/agreement", () => ({ acceptAgreement: h.acceptAgreement }));
vi.mock("@/lib/client-ip", () => ({ browserIp: h.browserIp }));
vi.mock("@/lib/rate-limit", () => ({ incrementRateLimit: h.incrementRateLimit }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(new Headers(h.requestHeaders)) }));

import { acceptAgreementAction } from "@/app/(portal)/settings/agreement/actions";

const PRESENTED = present({
  version: "v1",
  text: "# AvAI user agreement\n\nText.\n",
  assent: { text: "I have read and agree to the AvAI user agreement." },
  attestations: [
    { id: "age_18_plus", text: "I am 18 years of age or older.", required: true },
    { id: "updates_ok", text: "Email me about changes.", required: false },
  ],
});
const KEY = "22222222-2222-4222-8222-222222222222";

function form(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string | null> = {
    idempotencyKey: KEY,
    version: "v1",
    displayedAt: "2026-10-01T12:00:00.000Z",
    presentedInFull: "true",
    assent: "on",
    legalName: "  Jane   Q. Public ",
    displayName: "Jane",
    "attestation.age_18_plus": "on",
    ...overrides,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== null) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.selectRows = [{ avservAccountId: "acc-1" }];
  h.presented = PRESENTED;
  h.browserIp.mockResolvedValue("203.0.113.9");
  h.incrementRateLimit.mockImplementation(() => Promise.resolve({ allowed: h.rateAllowed }));
  h.rateAllowed = true;
  h.requestHeaders = { "user-agent": "Mozilla/5.0 Test", "accept-language": "en-US,en;q=0.9" };
  h.acceptAgreement.mockResolvedValue({
    acceptanceId: KEY,
    version: "v1",
    activated: true,
    activatedAt: "2026-10-01T12:00:05Z",
  });
});

describe("acceptAgreementAction", () => {
  it("sends the contract body with the page's key, the pinned hashes and the browser's details", async () => {
    const res = await acceptAgreementAction(null, form());

    expect(res).toEqual({ ok: true, activated: true });
    expect(h.acceptAgreement).toHaveBeenCalledTimes(1);
    const [accountId, key, body] = h.acceptAgreement.mock.calls[0]!;
    expect(accountId).toBe("acc-1");
    expect(key).toBe(KEY);
    expect(body).toMatchObject({
      version: "v1",
      contentHash: PRESENTED.contentHash,
      identity: { legalName: "Jane Q. Public", displayName: "Jane" },
      assent: {
        method: "checkbox_and_button",
        textHash: PRESENTED.assent.textHash,
        presentedInFull: true,
        displayedAt: "2026-10-01T12:00:00.000Z",
      },
      attestations: [{ id: "age_18_plus", textHash: PRESENTED.attestations[0]!.textHash, value: true }],
      client: { ip: "203.0.113.9", userAgent: "Mozilla/5.0 Test", locale: "en-US" },
    });
    expect(body.identity).not.toHaveProperty("email");
    expect(h.revalidatePath).toHaveBeenCalledWith("/settings");
    // The acceptance is logged by id — never the names or the IP.
    const logged = JSON.stringify(h.log.info.mock.calls);
    expect(logged).toContain(KEY);
    expect(logged).not.toMatch(/Jane|203\.0\.113\.9/);
  });

  it("reports the reserved 200 with activated:false loudly", async () => {
    h.acceptAgreement.mockResolvedValue({ acceptanceId: KEY, version: "v1", activated: false, activatedAt: null });
    expect(await acceptAgreementAction(null, form())).toEqual({ ok: true, activated: false });
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "agreement.accept.not_activated" }));
  });

  it("includes an optional attestation only when ticked", async () => {
    await acceptAgreementAction(null, form({ "attestation.updates_ok": "on" }));
    const body = h.acceptAgreement.mock.calls[0]![2];
    expect(body.attestations.map((a: { id: string }) => a.id)).toEqual(["age_18_plus", "updates_ok"]);
  });

  it("refuses when not signed in", async () => {
    h.sessionUserId = undefined;
    expect((await acceptAgreementAction(null, form())).ok).toBe(false);
    expect(h.acceptAgreement).not.toHaveBeenCalled();
  });

  it("refuses without a call while nothing is published", async () => {
    h.presented = null;
    const res = await acceptAgreementAction(null, form());
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/published/) });
    expect(h.acceptAgreement).not.toHaveBeenCalled();
  });

  it.each([
    ["the text was not scrolled to the end", { presentedInFull: "false" }, "presentedInFull"],
    ["the assent box is unticked", { assent: null }, "assent"],
    ["the legal name is blank", { legalName: "   " }, "legalName"],
    ["the idempotency key is not a UUID", { idempotencyKey: "nope" }, "idempotencyKey"],
  ])("refuses without a call when %s", async (_label, overrides, field) => {
    const res = await acceptAgreementAction(null, form(overrides));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.[field]).toBeDefined();
    expect(h.acceptAgreement).not.toHaveBeenCalled();
  });

  it("refuses without a call when a required attestation is unticked", async () => {
    const res = await acceptAgreementAction(null, form({ "attestation.age_18_plus": null }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.fieldErrors?.["attestation.age_18_plus"]).toBeDefined();
    expect(h.acceptAgreement).not.toHaveBeenCalled();
  });

  it("refuses a page rendered for another version", async () => {
    const res = await acceptAgreementAction(null, form({ version: "v0" }));
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/out of date/) });
    expect(h.acceptAgreement).not.toHaveBeenCalled();
  });

  it("refuses (loudly) rather than send anything but the browser's IP", async () => {
    h.browserIp.mockResolvedValue(null);
    const res = await acceptAgreementAction(null, form());
    expect(res.ok).toBe(false);
    expect(h.acceptAgreement).not.toHaveBeenCalled();
    expect(h.log.error).toHaveBeenCalledWith(expect.objectContaining({ event: "agreement.accept.no_browser_ip" }));
  });

  it("refuses a user with no AvServ link", async () => {
    h.selectRows = [{ avservAccountId: null }];
    expect((await acceptAgreementAction(null, form())).ok).toBe(false);
    expect(h.acceptAgreement).not.toHaveBeenCalled();
  });

  it("is rate-limited per user", async () => {
    h.rateAllowed = false;
    const res = await acceptAgreementAction(null, form());
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    expect(h.acceptAgreement).not.toHaveBeenCalled();
    expect(h.incrementRateLimit).toHaveBeenCalledWith("avai-accept:u1", expect.anything());
  });

  it("shows a stale pin to the user and reports it to Sentry", async () => {
    h.acceptAgreement.mockRejectedValue(
      new AgreementError("x", { status: 409, code: "agreement_wording_mismatch" }),
    );
    const res = await acceptAgreementAction(null, form());
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/updated/) });
    expect(h.captureException).toHaveBeenCalled();
  });

  it("puts an AvServ name refusal on the field", async () => {
    h.acceptAgreement.mockRejectedValue(
      new AgreementError("x", { status: 400, code: "invalid_display_name", detail: "no digits" }),
    );
    const res = await acceptAgreementAction(null, form());
    expect(res).toEqual({ ok: false, error: "no digits", fieldErrors: { displayName: ["no digits"] } });
  });

  it("surfaces an unreachable AvServ as retryable without Sentry", async () => {
    h.acceptAgreement.mockRejectedValue(new AgreementError("down", {}));
    const res = await acceptAgreementAction(null, form());
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/try again/i) });
    expect(h.log.warn).toHaveBeenCalled();
    expect(h.captureException).not.toHaveBeenCalled();
  });
});
