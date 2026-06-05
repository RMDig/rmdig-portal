import { beforeEach, describe, expect, it, vi } from "vitest";

const CODE_RE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const ACCOUNT = "11111111-1111-5111-8111-111111111111";

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "mock://localhost";
});

describe("mintLinkCode (mock path)", () => {
  it("returns a human-enterable, deterministic code per account", async () => {
    const { mintLinkCode } = await import("@/lib/avserv/client");

    const a = await mintLinkCode(ACCOUNT);
    const b = await mintLinkCode(ACCOUNT);

    expect(a.code).toMatch(CODE_RE);
    expect(a.code).toBe(b.code);
  });

  it("sets expiresAt to a near-future ISO timestamp (~10 min)", async () => {
    const { mintLinkCode } = await import("@/lib/avserv/client");

    const { expiresAt } = await mintLinkCode(ACCOUNT);
    const ms = new Date(expiresAt).getTime() - Date.now();

    expect(Number.isNaN(new Date(expiresAt).getTime())).toBe(false);
    expect(ms).toBeGreaterThan(9 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });

  it("gives different codes to different accounts", async () => {
    const { mintLinkCode } = await import("@/lib/avserv/client");

    const a = await mintLinkCode(ACCOUNT);
    const b = await mintLinkCode("22222222-2222-5222-8222-222222222222");

    expect(a.code).not.toBe(b.code);
  });

  it("throws on an empty accountId", async () => {
    const { mintLinkCode } = await import("@/lib/avserv/client");
    await expect(mintLinkCode("")).rejects.toThrow();
  });

  it("throws when AVSERV_BASE_URL is unset", async () => {
    delete process.env.AVSERV_BASE_URL;
    vi.resetModules();
    const { mintLinkCode } = await import("@/lib/avserv/client");
    await expect(mintLinkCode(ACCOUNT)).rejects.toThrow(/AVSERV_BASE_URL/);
  });
});
