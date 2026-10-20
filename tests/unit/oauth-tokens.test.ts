import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { describe, expect, it } from "vitest";

import { withoutOAuthTokens } from "@/lib/auth/oauth-tokens";

describe("withoutOAuthTokens (plan 36 H2)", () => {
  it("links the account without Google's tokens, keeping who it is", async () => {
    const linked: AdapterAccount[] = [];
    const base: Adapter = { linkAccount: (a) => (linked.push(a), Promise.resolve(a)) };
    await withoutOAuthTokens(base).linkAccount!({
      userId: "u1",
      type: "oidc",
      provider: "google",
      providerAccountId: "g-123",
      access_token: "ya29.secret",
      refresh_token: "1//secret",
      id_token: "eyJ.secret",
      expires_at: 1_800_000_000,
      scope: "openid email profile",
      token_type: "bearer",
    } as AdapterAccount);
    expect(linked[0]).toMatchObject({ userId: "u1", provider: "google", providerAccountId: "g-123" });
    expect(JSON.stringify(linked[0])).not.toContain("secret");
    expect(linked[0]!.expires_at).toBeUndefined();
  });

  it("refuses an adapter that can't link accounts", () => {
    expect(() => withoutOAuthTokens({})).toThrow(/linkAccount/);
  });
});
