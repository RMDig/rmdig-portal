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
  },
}));
vi.mock("@/lib/avserv/client", () => ({
  findOrCreateAccount: h.findOrCreateAccount,
  isAvServConfigured: h.isAvServConfigured,
}));
vi.mock("@/lib/logger", () => ({ logger: h.log }));

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
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: verified, avservAccountId: null }];
    h.findOrCreateAccount.mockResolvedValue({ accountId: "acc-1", created: true });
    h.updateRows = [{ id: "u1" }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).toHaveBeenCalledWith("a@rmdig.ai");
    expect(h.updateWhere).toHaveBeenCalledTimes(1); // guarded write attempted
  });

  it("is a no-op when the user is already mapped (idempotent)", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: verified, avservAccountId: "acc-existing" }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
    expect(h.updateWhere).not.toHaveBeenCalled();
  });

  it("skips an unverified email", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: null, avservAccountId: null }];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it("skips entirely when AvServ is not configured", async () => {
    h.isAvServConfigured.mockReturnValue(false);

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
  });

  it("never throws when AvServ fails — login must not be blocked", async () => {
    h.selectRows = [{ email: "a@rmdig.ai", emailVerified: verified, avservAccountId: null }];
    h.findOrCreateAccount.mockRejectedValue(new Error("avserv down"));

    await expect(mapUserToAvServAccountOnLogin("u1")).resolves.toBeUndefined();
    expect(h.log.error).toHaveBeenCalled();
  });

  it("warns and stops when the user row is missing", async () => {
    h.selectRows = [];

    await mapUserToAvServAccountOnLogin("u1");

    expect(h.findOrCreateAccount).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalled();
  });
});
