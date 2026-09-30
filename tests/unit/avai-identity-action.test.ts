import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgreementError } from "@/lib/avserv/agreement-types";

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  selectRows: [] as Array<{ avservAccountId: string | null }>,
  putIdentity: vi.fn(),
  rateAllowed: true,
  incrementRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
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
vi.mock("@/lib/avserv/agreement", () => ({ putIdentity: h.putIdentity }));
vi.mock("@/lib/rate-limit", () => ({ incrementRateLimit: h.incrementRateLimit }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@sentry/nextjs", () => ({ captureException: h.captureException }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

import { saveAvaiIdentityAction } from "@/app/(portal)/settings/avai-account-actions";

function form(legalName: string, displayName: string): FormData {
  const fd = new FormData();
  fd.set("legalName", legalName);
  fd.set("displayName", displayName);
  return fd;
}

function account(activated: boolean, needsAcceptance: boolean) {
  return {
    identityVersion: 4,
    activated,
    agreement: { currentVersion: "v1", needsAcceptance, required: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.selectRows = [{ avservAccountId: "acc-1" }];
  h.rateAllowed = true;
  h.incrementRateLimit.mockImplementation(() => Promise.resolve({ allowed: h.rateAllowed }));
  h.putIdentity.mockResolvedValue(account(false, true));
});

describe("saveAvaiIdentityAction", () => {
  it("sends the normalized names and never an email", async () => {
    const res = await saveAvaiIdentityAction(null, form("  Jane   Q. Public ", "Jane"));

    expect(res).toEqual({ ok: true, needsAcceptance: false });
    expect(h.putIdentity).toHaveBeenCalledWith("acc-1", {
      legalName: "Jane Q. Public",
      displayName: "Jane",
    });
    expect(h.revalidatePath).toHaveBeenCalledWith("/settings");
    // Names are PII: never logged.
    expect(JSON.stringify(h.log.info.mock.calls)).not.toMatch(/Jane/);
  });

  it("omits a blank field (unchanged), as the contract's omitted field", async () => {
    await saveAvaiIdentityAction(null, form("", "Jane"));
    expect(h.putIdentity).toHaveBeenCalledWith("acc-1", { displayName: "Jane" });
  });

  it("reports re-acceptance after a legal-name change on an activated account", async () => {
    h.putIdentity.mockResolvedValue(account(true, true));
    expect(await saveAvaiIdentityAction(null, form("Jane Public", ""))).toEqual({
      ok: true,
      needsAcceptance: true,
    });
  });

  it("refuses when not signed in", async () => {
    h.sessionUserId = undefined;
    expect((await saveAvaiIdentityAction(null, form("Jane", "Jane"))).ok).toBe(false);
    expect(h.putIdentity).not.toHaveBeenCalled();
  });

  it("refuses when both fields are blank, or a name is too long", async () => {
    expect((await saveAvaiIdentityAction(null, form(" ", " "))).ok).toBe(false);
    const long = await saveAvaiIdentityAction(null, form("Jane", "a".repeat(41)));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.fieldErrors?.displayName).toBeDefined();
    expect(h.putIdentity).not.toHaveBeenCalled();
  });

  it("refuses a user with no AvServ link", async () => {
    h.selectRows = [{ avservAccountId: null }];
    expect((await saveAvaiIdentityAction(null, form("Jane", "Jane"))).ok).toBe(false);
    expect(h.putIdentity).not.toHaveBeenCalled();
  });

  it("is rate-limited per user", async () => {
    h.rateAllowed = false;
    expect((await saveAvaiIdentityAction(null, form("Jane", "Jane"))).ok).toBe(false);
    expect(h.putIdentity).not.toHaveBeenCalled();
  });

  it("shows AvServ's refusal on the field", async () => {
    h.putIdentity.mockRejectedValue(
      new AgreementError("x", { status: 400, code: "invalid_display_name", detail: "no digits" }),
    );
    expect(await saveAvaiIdentityAction(null, form("Jane", "Jane2"))).toEqual({
      ok: false,
      error: "no digits",
      fieldErrors: { displayName: ["no digits"] },
    });
  });

  it("fails loud when AvServ is unreachable", async () => {
    h.putIdentity.mockRejectedValue(new AgreementError("down", {}));
    const res = await saveAvaiIdentityAction(null, form("Jane", "Jane"));
    expect(res.ok).toBe(false);
    expect(h.log.warn).toHaveBeenCalled();
  });
});
