import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(portal)/sar/[orgId]/area/actions", () => ({ checkAreaAction: vi.fn(), saveAreaAction: vi.fn() }));

import { AreaWarnings } from "@/app/(portal)/sar/[orgId]/area/AreaWarnings";
import type { CheckAreaResult } from "@/app/(portal)/sar/[orgId]/area/actions";

// The warnings shown for a drawn area (plan 33 §6.3, step 9.5): never a block,
// only what the admin should know before saving.

const CLIP = { type: "Polygon" as const, coordinates: [[[-106, 39], [-105.9, 39], [-105.9, 39.2], [-106, 39]]] as [number, number][][] };
const html = (check: CheckAreaResult | null, o: { checking?: boolean; usingClip?: boolean } = {}) =>
  renderToStaticMarkup(
    React.createElement(AreaWarnings, { checking: o.checking ?? false, check, usingClip: o.usingClip ?? false, onUseClip: () => {} }),
  ).replace(/&#x27;/g, "'");
const ok = (over: Partial<Extract<CheckAreaResult, { ok: true }>> = {}): CheckAreaResult => ({
  ok: true,
  areaKm2: 380,
  large: null,
  overlaps: [],
  clip: null,
  ...over,
});

describe("AreaWarnings", () => {
  it("says it's checking until the check is back", () => {
    expect(html(null, { checking: true })).toContain("Checking the area");
    expect(html(ok(), { checking: true })).toContain("Checking the area");
  });

  it("gives the size and nothing else for an ordinary area", () => {
    const out = html(ok());
    expect(out).toContain("about 380 km²");
    expect(out).not.toContain("larger than");
    expect(out).not.toContain("overlaps");
  });

  it("warns above Colorado's largest county, naming it and its size", () => {
    expect(html(ok({ areaKm2: 20_000, large: { thresholdKm2: 12_361.852647 } }))).toContain(
      "larger than Las Animas County, Colorado's largest county (about 12,362 km²)",
    );
  });

  it("names the teams it overlaps and offers the area without them", () => {
    const out = html(ok({ overlaps: [{ name: "Bravo SAR", overlapKm2: 190 }, { name: "Echo SAR", overlapKm2: 12 }], clip: { ok: true, area: CLIP, areaKm2: 178 } }));
    expect(out).toContain("areas of other teams");
    expect(out).toContain("<strong>Bravo SAR</strong> (190 km²)");
    expect(out).toContain("<strong>Echo SAR</strong> (12 km²)");
    expect(out).toContain("You can still save it as drawn.");
    expect(out).toContain("Use the area without the overlap (178 km²)");
    expect(html(ok({ overlaps: [{ name: "Bravo SAR", overlapKm2: 190 }], clip: { ok: true, area: CLIP, areaKm2: 178 } }), { usingClip: true })).toContain(
      "Using the area without the overlap (178 km²)",
    );
  });

  it("explains why it can't offer a clip, and shows a refused check as an error", () => {
    expect(html(ok({ overlaps: [{ name: "Bravo SAR", overlapKm2: 190 }], clip: { ok: false, message: "would split this one into 2 pieces" } }))).toContain(
      "would split this one into 2 pieces",
    );
    expect(html({ ok: false, error: "The outline is too small to keep." })).toContain('role="alert"');
  });
});
