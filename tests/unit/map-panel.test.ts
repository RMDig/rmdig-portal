import { describe, expect, it } from "vitest";

import type { LayerItem, MapLayer } from "@/lib/map/layers";
import { itemSections, mergedLegend, visibleItems } from "@/lib/map/panel";

// /map's panel (docs/plans/33): one list grouped by kind with open alerts
// from every team first, and one legend with each entry once.

const item = (id: string, group: LayerItem["group"], at?: string): LayerItem => ({
  id,
  group,
  label: id,
  summary: "",
  detail: "",
  at,
  rings: null,
  bounds: null,
  color: "#000000",
  dashed: false,
});
const layer = (id: string, items: LayerItem[], legend: MapLayer["legend"] = []): MapLayer => ({
  id,
  label: id,
  status: "ready",
  items,
  legend,
  emptyText: "",
});
const RED_LEGEND: MapLayer["legend"] = [{ glyph: "dot", color: "#dc2626", dashed: false, label: "Open alert: last location sent" }];

describe("map panel", () => {
  const teamA = layer("red:a", [item("a-old", "open-alert", "2026-10-01T00:00:00Z"), item("a-done", "closed-alert", "2026-10-05T00:00:00Z")], RED_LEGEND);
  const teamB = layer("red:b", [item("b-new", "open-alert", "2026-10-04T00:00:00Z")], RED_LEGEND);
  const mine = layer("my-orgs", [item("org:1", "area")]);
  const all = layer("all-orgs", [item("org:1", "area"), item("org:2", "area")]);
  const layers = [teamA, teamB, mine, all];
  const everything = new Set(layers.map((l) => l.id));

  it("lists open alerts from every team together, newest first, ahead of everything else", () => {
    const sections = itemSections(visibleItems(layers, everything));
    expect(sections.map((s) => [s.heading, s.items.map((i) => i.id)])).toEqual([
      ["Open alerts", ["b-new", "a-old"]],
      ["Resolved and retracted alerts", ["a-done"]],
      ["Service areas", ["org:1", "org:2"]],
    ]);
  });

  it("lists an org in two layers once, and leaves out switched-off layers", () => {
    expect(visibleItems(layers, everything).filter((i) => i.id === "org:1")).toHaveLength(1);
    expect(visibleItems(layers, new Set(["red:b", "all-orgs"])).map((i) => i.id)).toEqual(["b-new", "org:1", "org:2"]);
  });

  it("shows each legend entry once, only for switched-on layers with something to draw", () => {
    expect(mergedLegend(layers, everything)).toEqual(RED_LEGEND);
    expect(mergedLegend(layers, new Set(["my-orgs"]))).toEqual([]);
    expect(mergedLegend([layer("red:c", [], RED_LEGEND)], new Set(["red:c"]))).toEqual([]);
  });
});
