import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable test state + mock fns, hoisted so the vi.mock factories below can
// close over them (vi.mock is lifted above imports).
const h = vi.hoisted(() => ({
  selectRows: [] as Array<Record<string, unknown>>,
  updateRows: [] as Array<{ id: string }>,
  updateWhere: vi.fn(),
  findOrCreateAccount: vi.fn(),
  isAvServConfigured: vi.fn(() => true),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  reportError: vi.fn(),
  reportProblem: vi.fn(),
  AvServError: class AvServError extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.selectRows) }) }),
    }),
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => {
          h.updateWhere(...args);
          return { returning: () => Promise.resolve(h.updateRows) };
        },
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  users: {
    id: "id",
    email: "email",
    emailVerified: "emailVerified",
    avservAccountId: "avservAccountId",
    isDrill: "isDrill",
  },
}));
vi.mock("@/lib/avserv/client", () => ({
  findOrCreateAccount: h.findOrCreateAccount,
  isAvServConfigured: h.isAvServConfigured,
  AvServError: h.AvServError,
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/report-error", () => ({ reportError: h.reportError, reportProblem: h.reportProblem }));

import { mapUserToAvServAccountOnLogin } from "@/lib/avserv/account-link";

const verified = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.selectRows = [];
  h.updateRows = [];
  h.isAvServConfigured.mockReturnValue(true);
});

describe("mapUserToAvServAccountOnLogin", () => {
  it("maps and persists when the user has no avserv account yet", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: verified, avservAccountId: null, isDrill: false }];
    h.findOrCreateAccount.mockResolvedValue({ accountId: "acc-1", created: true, drill: false });
    h.updateRows = [{ id: "u1" }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).toHaveBeenCalledWith("a@rmdig.ai", { drill: false });
    expect(h.updateWhere).toHaveBeenCalledTimes(1); // guarded write attempted
  });

  it("is a no-op when the user is already mapped (idempotent)", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: verified, avservAccountId: "acc-existing", isDrill: false }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
    expect(h.updateWhere).not.toHaveBeenCalled();
  });

  it("skips an unverified email", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: null, avservAccountId: null, isDrill: false }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it("skips entirely when AvServ is not configured", async () => {
    h.isAvServConfigured.mockReturnValue(false);

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it("never throws when AvServ fails — login must not be blocked", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: verified, avservAccountId: null, isDrill: false }];
    h.findOrCreateAccount.mockRejectedValue(new Error("avserv down"));

    await expect(mapUserToAvServAccountOnLogin("u1")).resolves.toBeUndefined();
    expect(h.log.error).toHaveBeenCalled();
  });

  it("asks for a drill account for a drill user, and maps it", async () => {
    h.selectRows = [{ email: "ops+drill1@rmdig.ai", emailVerified: verified, avservAccountId: null, isDrill: true }];
    h.findOrCreateAccount.mockResolvedValue({ accountId: "acc-d", created: true, drill: true });
    h.updateRows = [{ id: "u1" }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).toHaveBeenCalledWith("ops+drill1@rmdig.ai", { drill: true });
    expect(h.updateWhere).toHaveBeenCalledTimes(1);
    expect(h.reportProblem).not.toHaveBeenCalled();
  });

  it.each([
    { isDrill: true, accountDrill: false },
    { isDrill: false, accountDrill: true },
  ])("never stores an account across the drill line (user drill $isDrill, account drill $accountDrill), and says so in Sentry", async ({ isDrill, accountDrill }) => {
    h.selectRows = [{ email: "ops+drill1@rmdig.ai", emailVerified: verified, avservAccountId: null, isDrill }];
    h.findOrCreateAccount.mockResolvedValue({ accountId: "acc-x", created: false, drill: accountDrill });

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.updateWhere).not.toHaveBeenCalled();
    expect(h.reportProblem).toHaveBeenCalledWith("avserv.map.drill_mismatch", expect.any(String), {
      userId: "u1",
      userDrill: isDrill,
      accountDrill,
    });
  });

  it.each([
    { status: 409, code: "account_drill_immutable" },
    { status: 403, code: "path_not_allowed" },
  ])("sends AvServ's $code refusal to Sentry, since the next login won't fix it", async ({ status, code }) => {
    h.selectRows = [{ email: "ops+drill1@rmdig.ai", emailVerified: verified, avservAccountId: null, isDrill: true }];
    const err = new h.AvServError("refused", status, code);
    h.findOrCreateAccount.mockRejectedValue(err);

    await expect(mapUserToAvServAccountOnLogin("u1")).resolves.toBeUndefined();

    expect(h.reportError).toHaveBeenCalledWith("avserv.map.refused", err, { userId: "u1", status, code });
    expect(h.updateWhere).not.toHaveBeenCalled();
  });

  it("warns and stops when the user row is missing", async () => {
    h.selectRows = [];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalled();
  });
});
