import { createHash } from "node:crypto";

import type { SarCapabilitySetting } from "../db/schema";

// Server-side terms rules (AvServ sar_terms.md / sar_team_sync.md). The body
// is stored exactly as the author wrote it and never re-serialized; its hash
// is over those UTF-8 bytes, because the app hashes the same string and sends
// it back on acceptance.

export function termsSha256(body: string): string {
  return createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
}

/** Users must accept a new version again unless the text is byte-identical to
 *  the previous version and capabilities were only removed (AvServ:
 *  `requiresReacceptance: false`). The first version always requires it. */
export function requiresReacceptance(
  previous: { body: string; capabilities: SarCapabilitySetting[] } | null,
  next: { body: string; capabilities: SarCapabilitySetting[] },
): boolean {
  if (!previous) return true;
  if (previous.body !== next.body) return true;
  const before = new Map(previous.capabilities.map((c) => [c.name, new Set(c.channels)]));
  for (const c of next.capabilities) {
    const had = before.get(c.name);
    if (!had) return true; // a capability was added
    if (c.channels.some((ch) => !had.has(ch))) return true; // a channel was added
  }
  return false;
}
