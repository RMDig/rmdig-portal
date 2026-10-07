"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { FitRequest } from "@/components/map/LayeredMap";
import { unionBounds, type Bounds } from "@/lib/map/geometry";
import type { LayerItem, MapLayer } from "@/lib/map/layers";
import { itemSections, mergedLegend, visibleItems } from "@/lib/map/panel";

import { GROUP_GLYPH, GlyphIcon, MapLegend } from "./MapLegend";

// Tall enough to be the page: most of the screen on a phone, the rest of the
// window beside the panel on a desktop.
const MAP_SIZE = "h-[55dvh] min-h-80 md:h-[calc(100dvh-11rem)] md:min-h-[480px]";

const LayeredMap = dynamic(() => import("@/components/map/LayeredMap"), {
  ssr: false,
  loading: () => <div className={`bg-muted w-full animate-pulse rounded-md border ${MAP_SIZE}`} />,
});

// The /map panel: layer checkboxes, one legend in plain words, and every shape
// as a list item (the accessible version of the map; selecting one highlights
// it and zooms to it). A layer that failed to load says so above the map,
// where it can't fall below the fold; it never shows as empty.
export function MapView({ layers }: { layers: MapLayer[] }) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(layers.map((l) => l.id)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fit, setFit] = useState<FitRequest | null>(null);
  const [closedOpen, setClosedOpen] = useState(false);

  const items = useMemo(() => visibleItems(layers, visible), [layers, visible]);
  const sections = useMemo(() => itemSections(items), [items]);
  const legend = useMemo(() => mergedLegend(layers, visible), [layers, visible]);
  const hasAlerts = layers.some((l) => l.id.startsWith("red:"));
  const flagged = layers.filter((l) => l.status === "error" || l.notice);

  const fitTo = (bounds: Bounds | null) => {
    if (bounds) setFit((f) => ({ bounds, n: (f?.n ?? 0) + 1 }));
  };

  function toggle(layerId: string, on: boolean) {
    const next = new Set(visible);
    if (on) next.add(layerId);
    else next.delete(layerId);
    setVisible(next);
    fitTo(unionBounds(visibleItems(layers, next).map((i) => i.bounds)));
  }

  function selectFromList(item: LayerItem) {
    setSelectedId(item.id);
    fitTo(item.bounds);
  }

  // A shape clicked on the map: open its row (resolved alerts are folded
  // away by default) and bring it into view.
  function selectFromMap(id: string) {
    setSelectedId(id);
    if (items.find((i) => i.id === id)?.group === "closed-alert") setClosedOpen(true);
    requestAnimationFrame(() => document.getElementById(`map-item-${id}`)?.scrollIntoView({ block: "nearest" }));
  }

  const row = (item: LayerItem) => {
    const selected = item.id === selectedId;
    return (
      <li key={item.id} id={`map-item-${item.id}`}>
        <button
          type="button"
          aria-current={selected ? "true" : undefined}
          onClick={() => selectFromList(item)}
          className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left ${selected ? "bg-muted ring-1 ring-neutral-300 dark:ring-neutral-700" : "hover:bg-muted"}`}
        >
          <span className="mt-0.5">
            <GlyphIcon glyph={GROUP_GLYPH[item.group]} color={item.color} dashed={item.dashed} />
          </span>
          <span className="min-w-0">
            <span className="block">{item.label}</span>
            <span className="text-muted-foreground block text-xs">{item.summary}</span>
            {selected && (item.detail !== item.summary || !item.bounds) ? (
              <span className="text-muted-foreground mt-1 block text-xs">
                {item.detail !== item.summary ? item.detail : null}
                {item.bounds ? null : `${item.detail !== item.summary ? " · " : ""}Not on the map`}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      {hasAlerts || flagged.length > 0 ? (
        <div className="space-y-2 text-sm">
          {hasAlerts ? (
            <p className="font-medium">
              Alert locations are the last ones the user&apos;s phone sent and may be old. In an emergency, call 911.
            </p>
          ) : null}
          {flagged.map((layer) =>
            layer.status === "error" ? (
              <div
                key={layer.id}
                role="alert"
                className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200"
              >
                <p>
                  <span className="font-medium">{layer.label}.</span>{" "}
                  {layer.errorText ?? "This layer couldn't load. Refresh to try again."}
                </p>
                {layer.link ? (
                  <Link href={layer.link.href} className="font-medium underline">
                    {layer.link.label}
                  </Link>
                ) : null}
              </div>
            ) : (
              <div
                key={layer.id}
                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
              >
                <p>
                  <span className="font-medium">{layer.label}.</span> {layer.notice}
                </p>
                {layer.link ? (
                  <Link href={layer.link.href} className="font-medium underline">
                    {layer.link.label}
                  </Link>
                ) : null}
              </div>
            ),
          )}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
        <div className="md:order-2">
          <LayeredMap items={items} selectedId={selectedId} fit={fit} onSelect={selectFromMap} className={MAP_SIZE} />
        </div>

        <aside className="space-y-5 text-sm md:order-1 md:max-h-[calc(100dvh-11rem)] md:min-h-[480px] md:overflow-y-auto md:pr-1">
          <section aria-labelledby="map-layers" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id="map-layers" className="font-medium">
                Layers
              </h2>
              <button
                type="button"
                onClick={() => fitTo(unionBounds(items.map((i) => i.bounds)))}
                className="text-xs font-medium underline"
              >
                Show everything
              </button>
            </div>
            <ul className="space-y-2">
              {layers.map((layer) => (
                <li key={layer.id}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={visible.has(layer.id)}
                      onChange={(e) => toggle(layer.id, e.target.checked)}
                    />
                    <span>
                      <span className="block">{layer.label}</span>
                      <span className="text-muted-foreground block text-xs">
                        {layer.status === "error"
                          ? "Couldn't load. See the message above the map."
                          : layer.status === "loading"
                            ? "Loading…"
                            : layer.items.length === 0
                              ? layer.emptyText
                              : `${layer.items.length} listed below`}
                      </span>
                    </span>
                  </label>
                  {layer.link && layer.status !== "error" ? (
                    <Link href={layer.link.href} className="ml-6 block text-xs font-medium underline">
                      {layer.link.label}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <MapLegend entries={legend} />

          {sections.map((s) =>
            s.group === "closed-alert" ? (
              <details key={s.group} open={closedOpen} onToggle={(e) => setClosedOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer font-medium">
                  {s.heading} ({s.items.length})
                </summary>
                <ul className="mt-1.5 space-y-0.5">{s.items.map(row)}</ul>
              </details>
            ) : (
              <section key={s.group} aria-labelledby={`map-group-${s.group}`} className="space-y-1.5">
                <h2 id={`map-group-${s.group}`} className="font-medium">
                  {s.heading} ({s.items.length})
                </h2>
                <ul className="space-y-0.5">{s.items.map(row)}</ul>
              </section>
            ),
          )}
        </aside>
      </div>
    </div>
  );
}
