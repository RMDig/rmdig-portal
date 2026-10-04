import { z } from "zod";

import { avservFetch, isMock } from "./request";
import type { AvServNode } from "./sar-teams";

// AvServ's operator lookup of accounts by email (account_agreement.md §4.1,
// route group account_lookup): POST, so the address never lands in a URL or
// an access log; the operator asking is named in X-AvAI-Reader and AvServ logs
// the lookup. One node's answer; the caller asks every node and merges by
// account, since a new account may not have replicated yet. Only a "login"
// match is verified; an "app" email proves nothing about who's asking.

export const AccountMatch = z.object({
  accountId: z.string(),
  verified: z.boolean(),
  source: z.enum(["login", "app"]),
  status: z.string(),
  createdAt: z.string(),
});
export type AccountMatch = z.infer<typeof AccountMatch>;

const Ok = z.object({ matches: z.array(AccountMatch) });
const ErrorBody = z.object({ code: z.string().optional() });

export type AccountLookupResult = { ok: true; node: string; matches: AccountMatch[] } | { ok: false; node: string; code: string };

export async function lookupAccountsByEmail(node: AvServNode, email: string, readerUserId: string): Promise<AccountLookupResult> {
  if (isMock(node.baseUrl)) return { ok: true, node: node.name, matches: [] };
  let res: Response;
  try {
    res = await avservFetch(node.baseUrl, "/v1/internal/accounts/lookup", {
      method: "POST",
      headers: { "content-type": "application/json", "x-avai-reader": `portal-user:${readerUserId}` },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, node: node.name, code: "unreachable" };
  }
  if (!res.ok) {
    const err = ErrorBody.safeParse(await res.json().catch(() => null));
    return { ok: false, node: node.name, code: (err.success && err.data.code) || `http_${res.status}` };
  }
  const parsed = Ok.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, node: node.name, matches: parsed.data.matches } : { ok: false, node: node.name, code: "bad_response" };
}

/** Every node's matches merged by account: verified if any node says so,
 *  login before app, then oldest first. Incomplete when a node didn't answer. */
export function mergeAccountMatches(results: AccountLookupResult[]): {
  status: "complete" | "incomplete" | "error";
  matches: AccountMatch[];
  unavailable: Array<{ node: string; code: string }>;
} {
  const unavailable = results.flatMap((r) => (r.ok ? [] : [{ node: r.node, code: r.code }]));
  const answered = results.filter((r): r is Extract<AccountLookupResult, { ok: true }> => r.ok);
  const byId = new Map<string, AccountMatch>();
  for (const r of answered) {
    for (const m of r.matches) {
      const seen = byId.get(m.accountId);
      byId.set(
        m.accountId,
        seen ? { ...seen, verified: seen.verified || m.verified, source: seen.source === "login" || m.source === "login" ? "login" : "app" } : m,
      );
    }
  }
  const matches = [...byId.values()].sort(
    (a, b) => (a.source === b.source ? 0 : a.source === "login" ? -1 : 1) || a.createdAt.localeCompare(b.createdAt),
  );
  return { status: answered.length === 0 ? "error" : unavailable.length ? "incomplete" : "complete", matches, unavailable };
}
