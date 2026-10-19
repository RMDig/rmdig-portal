import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Plan 36 rule 3 (owner, 2026-10-17): duress state never appears in the
// portal, so the portal has no word for it: not in code, copy, schemas or
// logs. AvServ never emits it (security_events.md §2); this keeps the portal
// from growing a place to put it.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|sql)$/.test(n) ? [p] : [];
  });
}

describe("no duress vocabulary", () => {
  it.each([...walk("app"), ...walk("lib"), ...walk("components")])("%s", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/duress|second[ _-]?pin/i);
  });
});
