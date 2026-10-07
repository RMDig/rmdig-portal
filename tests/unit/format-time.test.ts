import { describe, expect, it } from "vitest";

import { formatMountain, formatMountainDate } from "@/lib/format/time";

// Every date the portal shows is Mountain time, whatever zone the server runs
// in (UTC on Vercel), so a team and staff read the same clock.

describe("Mountain time", () => {
  it("shows a moment in Mountain time across the DST change", () => {
    expect(formatMountain(new Date("2026-10-04T08:00:00Z"))).toMatch(/Sun, Oct 4, 2:00\s?AM MDT/);
    expect(formatMountain(new Date("2026-12-04T08:00:00Z"))).toMatch(/Fri, Dec 4, 1:00\s?AM MST/);
  });

  it("puts a late-evening UTC date on the Mountain day, with the year", () => {
    // 03:00 UTC on Oct 7 is still Oct 6 in Denver.
    expect(formatMountainDate(new Date("2026-10-07T03:00:00Z"))).toBe("Oct 6, 2026");
  });
});

describe("no date in the server's zone", () => {
  it("formats every date through lib/format/time or with America/Denver named on the spot", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e) && !full.endsWith(join("lib", "format", "time.ts"))) {
          readFileSync(full, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (/\.toLocale(Date|Time)?String\(/.test(line) && !line.includes("America/Denver")) offenders.push(`${full}:${i + 1}`);
            });
        }
      }
    };
    for (const root of ["app", "components", "lib"]) walk(join(process.cwd(), root));
    expect(offenders).toEqual([]);
  });
});
