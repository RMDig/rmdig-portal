import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Every portal page sends signed-out visitors to sign-in through
// redirectToSignIn(), which keeps the page they asked for. Next renders a page
// alongside its layout, so a single bare redirect("/sign-in") would drop the
// return path whenever it ran first.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("portal sign-in redirects", () => {
  it.each(walk(join("app", "(portal)")))("%s keeps the return path", (p) => {
    expect(readFileSync(p, "utf8")).not.toMatch(/redirect\(\s*["'`]\/sign-in["'`]\s*\)/);
  });
});
