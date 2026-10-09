"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MaplibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { basemapStyle, attachBasemapFallback } from "@/components/map/basemap";
import { loadMaplibre } from "@/components/map/load-maplibre";
import { ringsBounds } from "@/lib/map/geometry";

export interface PreviewPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

// Read-only, non-interactive map that draws a SAR org's service area over the
// shared portal basemap, fit to the polygon — so a reviewer sees *where* the region is, not
// just its shape. MapLibre is dynamically imported inside the effect (it touches
// `window`), keeping SSR clean.


export default function RegionPreviewMap({ polygon }: { polygon: PreviewPolygon | null }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!polygon) return;
    let map: MaplibreMap | null = null;
    let cancelled = false;

    void (async () => {
      const maplibregl = await loadMaplibre();
      if (cancelled || !containerRef.current) return;
      // Framed from the first frame: fitting only after "load" showed the
      // default world view first and then jumped (2026-10-08).
      const bounds = ringsBounds(polygon.coordinates);
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle(),
        ...(bounds ? { bounds, fitBoundsOptions: { padding: 16 } } : {}),
        interactive: false,
        // Both basemaps require visible attribution on every map.
        attributionControl: { compact: true },
      });
      attachBasemapFallback(map);
      map.on("load", () => {
        if (cancelled || !map) return;
        map.addSource("region", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: polygon.coordinates },
          },
        });
        map.addLayer({
          id: "region-fill",
          type: "fill",
          source: "region",
          paint: { "fill-color": "#2563eb", "fill-opacity": 0.25 },
        });
        map.addLayer({
          id: "region-line",
          type: "line",
          source: "region",
          paint: { "line-color": "#2563eb", "line-width": 2 },
        });
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [polygon]);

  if (!polygon) {
    return (
      <div className="text-muted-foreground flex h-80 w-full items-center justify-center rounded-md border text-sm">
        No service area on file
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-md border"
      style={{ minHeight: "10rem" }}
      aria-label="Service area preview"
    />
  );
}
