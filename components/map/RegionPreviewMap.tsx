"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { LngLatBoundsLike, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";

export interface PreviewPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

// Read-only, non-interactive map that draws a SAR org's service area over an OSM
// basemap, fit to the polygon — so a reviewer sees *where* the region is, not
// just its shape. MapLibre is dynamically imported inside the effect (it touches
// `window`), keeping SSR clean; same OSM raster source as the draw map.
const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function polygonBounds(coordinates: number[][][]): LngLatBoundsLike {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of coordinates) {
    for (const position of ring) {
      const lon = position[0]!;
      const lat = position[1]!;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

export default function RegionPreviewMap({ polygon }: { polygon: PreviewPolygon | null }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!polygon) return;
    let map: MaplibreMap | null = null;
    let cancelled = false;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        interactive: false,
        attributionControl: false,
      });
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
        map.fitBounds(polygonBounds(polygon.coordinates), { padding: 16, animate: false });
      });
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [polygon]);

  if (!polygon) {
    return (
      <div className="text-muted-foreground flex h-40 w-full items-center justify-center rounded-md border text-sm">
        No service area on file
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-md border"
      style={{ minHeight: "10rem" }}
      aria-label="Service area preview"
    />
  );
}
