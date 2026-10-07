import type { ItemGroup, LayerItem, LegendEntry, MapLayer } from "./layers";

// What /map's panel and map show for the layers a viewer has switched on.
// Pure, so the grouping and the legend are tested without a browser.

const GROUP_ORDER: Array<{ group: ItemGroup; heading: string }> = [
  { group: "open-alert", heading: "Open alerts" },
  { group: "closed-alert", heading: "Resolved and retracted alerts" },
  { group: "area", heading: "Service areas" },
  { group: "target", heading: "Ad targets" },
];

/** Items of the switched-on layers, once each: a staff member who is also on
 *  a team has that team's area in two layers. */
export function visibleItems(layers: MapLayer[], visible: ReadonlySet<string>): LayerItem[] {
  const seen = new Set<string>();
  const items: LayerItem[] = [];
  for (const layer of layers) {
    if (!visible.has(layer.id)) continue;
    for (const item of layer.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export interface ItemSection {
  group: ItemGroup;
  heading: string;
  items: LayerItem[];
}

/** The list, by kind rather than by layer: open alerts from every team
 *  together and first, newest first. Empty sections are left out. */
export function itemSections(items: LayerItem[]): ItemSection[] {
  return GROUP_ORDER.flatMap(({ group, heading }) => {
    const inGroup = items.filter((i) => i.group === group);
    if (group === "open-alert" || group === "closed-alert") {
      inGroup.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    }
    return inGroup.length ? [{ group, heading, items: inGroup }] : [];
  });
}

/** One legend for everything switched on, each entry once. */
export function mergedLegend(layers: MapLayer[], visible: ReadonlySet<string>): LegendEntry[] {
  const seen = new Set<string>();
  const out: LegendEntry[] = [];
  for (const layer of layers) {
    if (!visible.has(layer.id) || layer.items.length === 0) continue;
    for (const e of layer.legend) {
      const key = `${e.glyph}|${e.color}|${e.dashed}|${e.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}
