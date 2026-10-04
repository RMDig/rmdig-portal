"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { Bounds } from "@/lib/map/geometry";
import type { MapLayer } from "@/lib/map/layers";

const LayeredMap = dynamic(() => import("@/components/map/LayeredMap"), {
  ssr: false,
  loading: () => <div className="bg-muted h-[60vh] min-h-80 w-full animate-pulse rounded-md border" />,
});

// The /map panel: layer checkboxes, a legend in plain words, and every shape
// as a list item (the accessible version of the map; selecting one zooms to
// it). A layer that failed to load says so; it never shows as empty.
function Swatch({ color, dashed }: { color: string; dashed: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-5 shrink-0 rounded-sm border-2"
      style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid", backgroundColor: `${color}2e` }}
    />
  );
}

export function MapView({ layers }: { layers: MapLayer[] }) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(layers.map((l) => l.id)));
  const [focus, setFocus] = useState<Bounds | null>(null);
  const items = useMemo(() => layers.filter((l) => visible.has(l.id)).flatMap((l) => l.items), [layers, visible]);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
      <LayeredMap items={items} focus={focus} />
      <aside className="space-y-6 text-sm">
        {layers.map((layer) => (
          <section key={layer.id} className="space-y-2">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={visible.has(layer.id)}
                onChange={(e) =>
                  setVisible((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(layer.id);
                    else next.delete(layer.id);
                    return next;
                  })
                }
              />
              {layer.label}
            </label>

            {layer.notice && layer.status !== "error" ? (
              <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                {layer.notice}
              </p>
            ) : null}
            {layer.link ? (
              <Link href={layer.link.href} className="block text-xs font-medium underline">
                {layer.link.label}
              </Link>
            ) : null}
            {layer.status === "error" ? (
              <p role="alert" className="text-red-600">
                {layer.errorText ?? "This layer couldn't load. Refresh to try again."}
              </p>
            ) : layer.status === "loading" ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : layer.items.length === 0 ? (
              <p className="text-muted-foreground">{layer.emptyText}</p>
            ) : (
              <>
                <ul className="space-y-1" aria-label={`${layer.label}: legend`}>
                  {layer.legend.map((l) => (
                    <li key={l.label} className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Swatch color={l.color} dashed={l.dashed} />
                      {l.label}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1" aria-label={layer.label}>
                  {layer.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        disabled={!item.bounds}
                        onClick={() => item.bounds && setFocus(item.bounds)}
                        className="hover:bg-muted flex w-full items-start gap-2 rounded px-1 py-1 text-left disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span className="mt-1">
                          <Swatch color={item.color} dashed={item.dashed} />
                        </span>
                        <span>
                          <span className="block">{item.label}</span>
                          <span className="text-muted-foreground block text-xs">{item.detail}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </aside>
    </div>
  );
}
