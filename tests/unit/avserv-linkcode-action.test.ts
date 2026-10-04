import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sessionUserId: "u1" as string | undefined,
  selectRows: [] as Array<{ avservAccountId: string | null }>,
  mintLinkCode: vi.fn(),
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

import { mintDeviceLinkCodeAction } from "@/app/(portal)/settings/actions";

const fd = new FormData();

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUserId = "u1";
  h.selectRows = [];
});vi.mock("@/lib/auth/mfa-gate", () => ({ userMfaGate: () => Promise.resolve({ gate: "ok", roles: [] }) }));


describe("mintDeviceLinkCodeAction", () => {
  it("mints a code for a mapped, signed-in user", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.mintLinkCode.mockResolvedValue({ code: "ABCD-2345", expiresAt: "2026-06-04T00:10:00Z" });

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(h.mintLinkCode).toHaveBeenCalledWith("acc-1");
    expect(res).toEqual({ ok: true, code: "ABCD-2345", expiresAt: "2026-06-04T00:10:00Z" });
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

  it("surfaces a friendly error when minting fails", async () => {
    h.selectRows = [{ avservAccountId: "acc-1" }];
    h.mintLinkCode.mockRejectedValue(new Error("avserv down"));

    const res = await mintDeviceLinkCodeAction(null, fd);

    expect(res.ok).toBe(false);
    expect(h.log.error).toHaveBeenCalled();
  });
});
