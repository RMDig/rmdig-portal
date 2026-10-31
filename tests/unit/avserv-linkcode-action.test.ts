import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  selectRows: [] as Array<{ avservAccountId: string | null }>,
  mintLinkCode: vi.fn(),
  rlAllowed: true,
  rlKeys: [] as string[],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  auth: () =>
    Promise.resolve(h.sessionUserId ? { user: { id: h.sessionUserId } } : null),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.selectRows) }) }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  users: { id: "id", avservAccountId: "avservAccountId" },
}));
vi.mock("@/lib/avserv/client", () => ({ mintLinkCode: h.mintLinkCode }));
vi.mock("@/lib/logger", () => ({ logger: h.log }));
vi.mock("@/lib/rate-limit", () => ({
  incrementRateLimit: (key: string) => {
    h.rlKeys.push(key);
    return Promise.resolve({ allowed: h.rlAllowed, attempts: 1, resetAt: new Date() });
  },
}));

import { mintDeviceLinkCodeAction } from "@/app/(portal)/settings/actions";
import { AvServRateLimitedError } from "@/lib/avserv/request";

const fd = new FormData();

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.selectRows = [];
  h.rlAllowed = true;
  h.rlKeys = [];
});vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));


describe("mintDeviceLinkCodeAction", () => {
  it("mints a code for a mapped, signed-in user", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.mintLinkCode.mockResolvedValue({ code: "ABCD-2345", expiresAt: "2026-06-04T00:10:00Z" });

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(h.mintLinkCode).toHaveBeenCalledWith("acc-1");
    expect(res).toEqual({ ok: true, code: "ABCD-2345", expiresAt: "2026-06-04T00:10:00Z" });
  });

  it("stops at ten codes a day, before asking AvServ", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.rlAllowed = false;
    const res = await mintDeviceLinkCodeAction(null, fd);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/10 link codes today/) });
    expect(h.rlKeys).toEqual(["linkcode:u1"]);
    expect(h.mintLinkCode).not.toHaveBeenCalled();
  });

  it("refuses when not signed in", async () => {
    h.sessionUserId = undefined;

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(res.ok).toBe(false);
    expect(h.mintLinkCode).not.toHaveBeenCalled();
  });

  it("guards a user with no AvServ account yet", async () => {
    h.selectRows = [{ avservAccountId: null }];

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/isn't linked/i);
    expect(h.mintLinkCode).not.toHaveBeenCalled();
    expect(h.log.warn).toHaveBeenCalled();
  });

  it("says when AvServ's own cap refuses, without retrying", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.mintLinkCode.mockRejectedValue(new AvServRateLimitedError("over cap", 5 * 3600));

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(res).toEqual({ ok: false, error: "Too many link codes today. Try again in about 5 hours." });
    expect(h.mintLinkCode).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalled();
    expect(h.log.error).not.toHaveBeenCalled();
  });

  it("falls back to 'later today' when the refusal has no Retry-After", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.mintLinkCode.mockRejectedValue(new AvServRateLimitedError("over cap", undefined));

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(res).toEqual({ ok: false, error: "Too many link codes today. Try again later today." });
  });

  it("surfaces a friendly error when minting fails", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.mintLinkCode.mockRejectedValue(new Error("avserv down"));

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(res.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalled();
  });
});
