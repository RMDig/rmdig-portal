"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { basemapStyle, attachBasemapFallback } from "@/components/map/basemap";
import { unionBounds, type Bounds } from "@/lib/map/geometry";
import type { LayerItem } from "@/lib/map/layers";

// Draws the visible layer items of /map. It only renders what it's handed:
// scoping happens on the server. MapLibre touches `window`, so it's imported
// inside the effect, and this component is itself loaded with ssr:false.

const SOURCE = "items";

function toFeatureCollection(items: LayerItem[]) {
  const props = (i: LayerItem) => ({ color: i.color, dashed: i.dashed, label: i.label });
  return {
    type: "FeatureCollection" as const,
    features: items.flatMap((i) => [
      ...(i.rings ? [{ type: "Feature" as const, properties: props(i), geometry: { type: "Polygon" as const, coordinates: i.rings } }] : []),
      ...(i.lines ? [{ type: "Feature" as const, properties: props(i), geometry: { type: "MultiLineString" as const, coordinates: i.lines } }] : []),
      ...(i.point ? [{ type: "Feature" as const, properties: props(i), geometry: { type: "Point" as const, coordinates: i.point } }] : []),
    ]),
  };
}

export default function LayeredMap({ items, focus }: { items: LayerItem[]; focus: Bounds | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const loadedRef = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
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
      });
      attachBasemapFallback(map);
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (cancelled) return;
        map.addSource(SOURCE, { type: "geojson", data: toFeatureCollection(itemsRef.current) });
        map.addLayer({
          id: "items-fill",
          type: "fill",
          source: SOURCE,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 },
        });
        map.addLayer({
          id: "items-line",
          type: "line",
          source: SOURCE,
          filter: ["!", ["get", "dashed"]],
          paint: { "line-color": ["get", "color"], "line-width": 2 },
        });
        map.addLayer({
          id: "items-line-dashed",
          type: "line",
          source: SOURCE,
          filter: ["get", "dashed"],
          paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [2, 2] },
        });
        map.addLayer({
          id: "items-point",
          type: "circle",
          source: SOURCE,
          filter: ["==", ["geometry-type"], "Point"],
          paint: { "circle-color": ["get", "color"], "circle-radius": 6, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
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

  // Fly to a selected item.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !focus) return;
    map.fitBounds(focus, { padding: 48, maxZoom: 12 });
  }, [focus]);

  return (
    <div
      ref={containerRef}
      className="h-[60vh] min-h-80 w-full overflow-hidden rounded-md border"
      role="img"
      aria-label="Map of the areas listed beside it"
    />
  );
}
