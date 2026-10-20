import type { Adapter, AdapterAccount } from "next-auth/adapters";

// Google sign-in is for identity only: nothing in the portal calls a Google
// API, so the access, refresh and ID tokens Auth.js would store are never read
// (plan 36 H2). Holding them would only give a copy of the database something
// to use against a Google account. This drops them before the account is
// linked; migration 0033 cleared the ones stored before.

export function withoutOAuthTokens(base: Adapter): Adapter {
  const { linkAccount } = base;
  if (!linkAccount) throw new Error("oauth tokens: the base adapter lacks linkAccount");
  return {
    ...base,
    linkAccount(account: AdapterAccount) {
      return linkAccount({
        ...account,
        access_token: undefined,
        refresh_token: undefined,
        id_token: undefined,
        expires_at: undefined,
        session_state: undefined,
      });
    },
  };
}
