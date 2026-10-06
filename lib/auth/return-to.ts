// Where to send someone after sign-in: the portal page they were trying to
// reach (an invite, an AvServ notice's /account/review link), carried as
// `?next=` through sign-in, Google sign-in, the MFA step, and sign-up → email
// verification. Only a same-site path is accepted, so the parameter can't be
// used to bounce a user to another site after they sign in.

const MAX = 500;

export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX) return null;
  // One leading slash, then not a second one or a backslash (both make a
  // protocol-relative URL in browsers), no scheme, no control characters.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  // Never back into the auth pages themselves.
  if (/^\/(sign-in|sign-up|verify-email|forgot-password|reset-password)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

/** `?next=` for a link to sign-in or sign-up, or "" when there's nowhere to return. */
export function nextQuery(returnTo: string | null | undefined, prefix: "?" | "&" = "?"): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `${prefix}next=${encodeURIComponent(safe)}` : "";
}
