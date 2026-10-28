import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings → AvAI account. While AvServ has agreement capture off or nothing
// published, the card has no action to offer, so it isn't shown at all; every
// other failure still says something.

const getAccount = vi.fn();
vi.mock("@/lib/avserv/agreement", () => ({ getAccount: (...a: unknown[]) => getAccount(...a) }));
vi.mock("@/app/(portal)/settings/AvaiIdentityForm", () => ({ AvaiIdentityForm: () => null }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { AvaiAccountCard } = await import("@/app/(portal)/settings/AvaiAccountCard");
const { AgreementError } = await import("@/lib/avserv/agreement-types");

const props = { userId: "u1", avservAccountId: "acct-1", portalName: "Pat" };

describe("AvaiAccountCard", () => {
  // Braces matter: a returned function is taken as the hook's teardown.
  beforeEach(() => {
    getAccount.mockReset();
  });

  it.each(["agreement_capture_disabled", "agreement_not_published"])(
    "renders nothing when AvServ answers %s",
    async (code) => {
      getAccount.mockRejectedValue(new AgreementError("x", { status: 404, code }));
      expect(await AvaiAccountCard(props)).toBeNull();
    },
  );

  it("still shows a card when AvServ is down", async () => {
    getAccount.mockRejectedValue(new AgreementError("x", { status: 503 }));
    expect(await AvaiAccountCard(props)).not.toBeNull();
  });

  it("still shows a card when the account isn't linked", async () => {
    expect(await AvaiAccountCard({ ...props, avservAccountId: null })).not.toBeNull();
    expect(getAccount).not.toHaveBeenCalled();
  });
});
