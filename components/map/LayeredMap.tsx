"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { ExpressionSpecification, GeoJSONSource, Map as MaplibreMap, Popup } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { basemapStyle, attachBasemapFallback } from "@/components/map/basemap";
import { unionBounds, type Bounds } from "@/lib/map/geometry";
import type { ItemGroup, LayerItem } from "@/lib/map/layers";

// Draws the visible layer items of /map. It only renders what it's handed:
// scoping happens on the server. MapLibre touches `window`, so it's imported
// inside the effect, and this component is itself loaded with ssr:false.

const SOURCE = "items";

// Draw order inside each map layer: open alerts on top, then closed alerts,
// service areas, ad targets. A staff member's org areas never cover an alert.
const RANK: Record<ItemGroup, number> = { "open-alert": 3, "closed-alert": 2, area: 1, target: 0 };

function toFeatureCollection(items: LayerItem[]) {
  const props = (i: LayerItem) => ({
    itemId: i.id,
    color: i.color,
    dashed: i.dashed,
    rank: RANK[i.group],
    // A closed alert is an outline and a hollow dot, never a filled shape.
    closed: i.group === "closed-alert",
  });
  return {
    type: "FeatureCollection" as const,
    features: items.flatMap((i) => [
      ...(i.rings ? [{ type: "Feature" as const, properties: props(i), geometry: { type: "Polygon" as const, coordinates: i.rings } }] : []),
      ...(i.lines ? [{ type: "Feature" as const, properties: props(i), geometry: { type: "MultiLineString" as const, coordinates: i.lines } }] : []),
      ...(i.point ? [{ type: "Feature" as const, properties: props(i), geometry: { type: "Point" as const, coordinates: i.point } }] : []),
    ]),
  };
}

const selectedFilter = (id: string | null): ExpressionSpecification => ["==", ["get", "itemId"], id ?? ""];
const CLICKABLE = ["items-fill", "items-line", "items-line-dashed", "items-point"];

/** A request to fit the map to `bounds`. `n` changes on every request, so
 *  asking for the same item twice flies there again. */
export interface FitRequest {
  bounds: Bounds;
  n: number;
}

export default function LayeredMap({
  items,
  selectedId,
  fit,
  onSelect,
  className,
}: {
  items: LayerItem[];
  selectedId: string | null;
  fit: FitRequest | null;
  onSelect: (id: string) => void;
  className: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const popupRef = useRef<{ popup: Popup; itemId: string } | null>(null);
  const loadedRef = useRef(false);
  const itemsRef = useRef(items);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    itemsRef.current = items;
    selectedRef.current = selectedId;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle(),
        center: [-105.5, 39.0],
        zoom: 6,
        attributionControl: { compact: true },
        // On a phone, one finger scrolls the page and two move the map, so a
        // tall map can't trap the panel below it.
        cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
      });
      attachBasemapFallback(map);
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (cancelled) return;
        // Fills and outlines go under the basemap's labels so peak and town
        // names stay readable; dots stay on top. The OSM fallback has no
        // label layers, so there everything is simply added last.
        const beneathLabels = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
        map.addSource(SOURCE, { type: "geojson", data: toFeatureCollection(itemsRef.current) });
        map.addLayer(
          {
            id: "items-fill",
            type: "fill",
            source: SOURCE,
            filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!", ["get", "closed"]]],
            layout: { "fill-sort-key": ["get", "rank"] },
            paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
          },
          beneathLabels,
        );
        map.addLayer(
          {
            id: "items-line",
            type: "line",
            source: SOURCE,
            filter: ["!", ["get", "dashed"]],
            layout: { "line-sort-key": ["get", "rank"] },
            paint: { "line-color": ["get", "color"], "line-width": 2 },
          },
          beneathLabels,
        );
        map.addLayer(
          {
            id: "items-line-dashed",
            type: "line",
            source: SOURCE,
            filter: ["get", "dashed"],
            layout: { "line-sort-key": ["get", "rank"] },
            paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2] },
          },
          beneathLabels,
        );
        map.addLayer({
          id: "items-selected-line",
          type: "line",
          source: SOURCE,
          filter: selectedFilter(selectedRef.current),
          paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "items-point",
          type: "circle",
          source: SOURCE,
          filter: ["==", ["geometry-type"], "Point"],
          layout: { "circle-sort-key": ["get", "rank"] },
          paint: {
            "circle-color": ["case", ["get", "closed"], "#ffffff", ["get", "color"]],
            "circle-radius": 6,
            "circle-stroke-color": ["case", ["get", "closed"], ["get", "color"], "#ffffff"],
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "items-selected-point",
          type: "circle",
          source: SOURCE,
          filter: ["all", ["==", ["geometry-type"], "Point"], selectedFilter(selectedRef.current)],
          paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": 11, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 },
        });

        // Clicking a shape selects its row in the panel and says what it is.
        // The popup is built from text nodes, never HTML.
        map.on("click", CLICKABLE, (e) => {
          const top = [...(e.features ?? [])].sort((a, b) => Number(b.properties.rank) - Number(a.properties.rank))[0];
          const item = itemsRef.current.find((i) => i.id === top?.properties.itemId);
          if (!item) return;
          popupRef.current?.popup.remove();
          const body = document.createElement("div");
          const title = document.createElement("p");
          title.className = "font-medium";
          title.textContent = item.label;
          const detail = document.createElement("p");
          detail.textContent = item.detail;
          body.append(title, detail);
          const popup = new maplibregl.Popup({ maxWidth: "18rem" }).setLngLat(e.lngLat).setDOMContent(body).addTo(map);
          popupRef.current = { popup, itemId: item.id };
          onSelectRef.current(item.id);
        });
        for (const id of CLICKABLE) {
          map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
        }

        loadedRef.current = true;
        const b = unionBounds(itemsRef.current.map((i) => i.bounds));
        if (b) map.fitBounds(b, { padding: 32, animate: false, maxZoom: 11 });
      });
    })();
    return () => {
      cancelled = true;
      loadedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw when the visible layers change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(toFeatureCollection(items));
  }, [items]);

  // Highlight the selected item; a popup for some other item closes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("items-selected-line", selectedFilter(selectedId));
    map.setFilter("items-selected-point", ["all", ["==", ["geometry-type"], "Point"], selectedFilter(selectedId)]);
    if (popupRef.current && popupRef.current.itemId !== selectedId) {
      popupRef.current.popup.remove();
      popupRef.current = null;
    }
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !fit) return;
    map.fitBounds(fit.bounds, { padding: 48, maxZoom: 12 });
  }, [fit]);

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden rounded-md border ${className}`}
      role="region"
      aria-label="Map. Everything on it is listed in the panel."
    />
  );
}
