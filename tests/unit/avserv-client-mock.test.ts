import { beforeEach, describe, expect, it, vi } from "vitest";

// v5-shaped UUID: version nibble 5, variant nibble in [89ab].
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.resetModules();
  process.env.AVSERV_BASE_URL = "mock://localhost";
});

describe("findOrCreateAccount (mock path)", () => {
  it("returns a UUID-shaped, deterministic accountId per email", async () => {
    const { findOrCreateAccount, __resetAvServMock } = await import("@/lib/avserv/client");
    __resetAvServMock();

    const a = await findOrCreateAccount("user@rmdig.ai");
    const b = await findOrCreateAccount("user@rmdig.ai");

    expect(a.accountId).toMatch(UUID_RE);
    expect(a.accountId).toBe(b.accountId);
  });

  it("reports created=true on first map then false (idempotent)", async () => {
    const { findOrCreateAccount, __resetAvServMock } = await import("@/lib/avserv/client");
    __resetAvServMock();

    expect((await findOrCreateAccount("new@rmdig.ai")).created).toBe(true);
    expect((await findOrCreateAccount("new@rmdig.ai")).created).toBe(false);
  });

  it("normalizes case so Email and email resolve to one account", async () => {
    const { findOrCreateAccount, __resetAvServMock } = await import("@/lib/avserv/client");
    __resetAvServMock();

    const upper = await findOrCreateAccount("Foo@Bar.com");
    const lower = await findOrCreateAccount("foo@bar.com");

    expect(lower.accountId).toBe(upper.accountId);
    expect(lower.created).toBe(false); // the lowercase form was already seen
  });

  it("keeps an account's drill kind from its creation, and refuses the other kind with AvServ's 409", async () => {
    const { findOrCreateAccount, __resetAvServMock } = await import("@/lib/avserv/client");
    __resetAvServMock();

    expect(await findOrCreateAccount("ops+drill1@rmdig.ai", { drill: true })).toMatchObject({ created: true, drill: true });
    expect(await findOrCreateAccount("ops+drill1@rmdig.ai", { drill: true })).toMatchObject({ created: false, drill: true });
    await expect(findOrCreateAccount("ops+drill1@rmdig.ai")).rejects.toMatchObject({ status: 409, code: "account_drill_immutable" });
    expect(await findOrCreateAccount("real@rmdig.ai")).toMatchObject({ drill: false });
    await expect(findOrCreateAccount("real@rmdig.ai", { drill: true })).rejects.toMatchObject({ code: "account_drill_immutable" });
  });

  it("gives different accounts to different emails", async () => {
    const { findOrCreateAccount, __resetAvServMock } = await import("@/lib/avserv/client");
    __resetAvServMock();

    const a = await findOrCreateAccount("a@rmdig.ai");
    const b = await findOrCreateAccount("b@rmdig.ai");

    expect(a.accountId).not.toBe(b.accountId);
  });

  it("throws on an empty email", async () => {
    const { findOrCreateAccount } = await import("@/lib/avserv/client");
    await expect(findOrCreateAccount("   ")).rejects.toThrow();
  });

  it("throws when AVSERV_BASE_URL is unset", async () => {
    delete process.env.AVSERV_BASE_URL;
    vi.resetModules();
    const { findOrCreateAccount } = await import("@/lib/avserv/client");
    await expect(findOrCreateAccount("a@rmdig.ai")).rejects.toThrow(/AVSERV_BASE_URL/);
  });
});
