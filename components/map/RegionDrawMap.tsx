"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MaplibreMap } from "maplibre-gl";
import type { TerraDraw } from "terra-draw";
import { useEffect, useRef } from "react";

import { OSM_STYLE } from "@/components/map/basemap";

import { Button } from "@/components/ui/button";

// A drawn service-area polygon, in GeoJSON axis order [lon, lat]. Kept loose on
// the client (number[][][]); the server re-validates with RegionPolygonSchema.
export interface DrawnPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

interface RegionDrawMapProps {
  onRegionChange: (polygon: DrawnPolygon | null) => void;
  hasRegion: boolean;
}

// Free OpenStreetMap raster basemap — no API key, fine for drawing a service
// area at low volume (the tile-usage policy is acceptable at this scale; revisit
// a vector provider if usage grows). MapLibre + Terra Draw run only in the
// browser, so everything heavy is dynamically imported inside the effect to keep
// it out of SSR (MapLibre touches `window` at construction).

export default function RegionDrawMap({ onRegionChange, hasRegion }: RegionDrawMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  // Hold the latest callback in a ref so the init effect can stay []-deps and
  // never re-create the map when the parent re-renders with a new closure.
  const onChangeRef = useRef(onRegionChange);
  useEffect(() => {
    onChangeRef.current = onRegionChange;
  }, [onRegionChange]);

  useEffect(() => {
    let map: MaplibreMap | null = null;
    let draw: TerraDraw | null = null;
    let cancelled = false;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      const { TerraDraw, TerraDrawPolygonMode } = await import("terra-draw");
      const { TerraDrawMapLibreGLAdapter } = await import("terra-draw-maplibre-gl-adapter");
      if (cancelled || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [-106.0, 39.0], // Colorado-ish; the user pans to their area
        zoom: 6,
      });
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode()],
      });
      drawRef.current = draw;

      map.on("load", () => {
        if (cancelled || !draw) return;
        draw.start();
        draw.setMode("polygon");
      });

      // A SAR org has one service area. When a polygon is finished, drop any
      // earlier one and report the new geometry up to the form.
      draw.on("finish", (id) => {
        if (!draw) return;
        const all = draw.getSnapshot();
        const stale = all.filter((f) => f.id !== id).map((f) => f.id!);
        if (stale.length) draw.removeFeatures(stale);
        const feature = all.find((f) => f.id === id);
        if (feature && feature.geometry.type === "Polygon") {
          onChangeRef.current({
            type: "Polygon",
            coordinates: feature.geometry.coordinates as number[][][],
          });
        }
      });
    })();

    return () => {
      cancelled = true;
      try {
        draw?.stop();
      } catch {
        // stop() throws if the adapter never started (fast unmount); harmless.
      }
      map?.remove();
      drawRef.current = null;
    };
  }, []);

  function handleClear() {
    drawRef.current?.clear();
    onChangeRef.current(null);
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-80 w-full overflow-hidden rounded-md border"
        // Min height as a fallback if the utility class is purged in odd builds.
        style={{ minHeight: "20rem" }}
        aria-label="Draw your service area"
      />
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Click to place points; click the first point to close the polygon. Draw a new one to
          replace it.
        </p>
        {hasRegion ? (
          <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
