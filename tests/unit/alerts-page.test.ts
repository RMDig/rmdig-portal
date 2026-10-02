import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// rmdig.ai/alerts is where a worried contact lands (avai.rmdig.ai redirects
// here). These statements are load-bearing for the contact's decisions (AvServ
// plan 22 §6.5, plan 38 §9.5): keep them on the page.

const src = readFileSync(join(process.cwd(), "app", "(public)", "alerts", "page.tsx"), "utf8")
  .replace(/\s+/g, " ");

describe("/alerts contact explainer", () => {
  it("tells contacts duplicates happen and to treat any alert as real", () => {
    expect(src).toMatch(/same alert more than once/);
    expect(src).toMatch(/Treat any alert as real until you reach the person/);
  });

  it("says AvAI never calls emergency services itself", () => {
    expect(src).toMatch(/never calls 911 or any emergency service itself/);
  });

  it("says AvAI is not a beacon and the location may be old", () => {
    expect(src).toMatch(/It is not a beacon/);
    expect(src).toMatch(/last one their phone sent to us/);
  });
});
