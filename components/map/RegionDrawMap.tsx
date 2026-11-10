"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MaplibreMap } from "maplibre-gl";
import type { TerraDraw } from "terra-draw";
import { useEffect, useRef, useState } from "react";

import { basemapStyle, attachBasemapFallback } from "@/components/map/basemap";
import { loadMaplibre } from "@/components/map/load-maplibre";
import { ringsBounds } from "@/lib/map/geometry";

import { Button } from "@/components/ui/button";

// A drawn service-area polygon, in GeoJSON axis order [lon, lat]. Kept loose on
// the client (number[][][]); the server re-validates with RegionPolygonSchema.
export interface DrawnPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

interface RegionDrawMapProps {
  /** The area to show: the last drawing, or points typed into the vertex table. */
  region: DrawnPolygon | null;
  onRegionChange: (polygon: DrawnPolygon | null) => void;
}

// The shared portal basemap (components/map/basemap.ts). MapLibre + Terra Draw run only in the
// browser, so everything heavy is dynamically imported inside the effect to keep
// it out of SSR (MapLibre touches `window` at construction).

export default function RegionDrawMap({ region, onRegionChange }: RegionDrawMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  // Hold the latest callback in a ref so the init effect can stay []-deps and
  // never re-create the map when the parent re-renders with a new closure.
  const onChangeRef = useRef(onRegionChange);
  useEffect(() => {
    onChangeRef.current = onRegionChange;
  }, [onRegionChange]);
  // The area the map last reported. A `region` that is this one is already on
  // the map; any other came from the vertex table and is drawn in.
  const emittedRef = useRef<DrawnPolygon | null>(null);
  const regionRef = useRef(region);
  const [unshowable, setUnshowable] = useState<string | null>(null);

  // Put `regionRef.current` on the map, replacing what's there. Before the map
  // has loaded this does nothing; the load handler calls it.
  const showRef = useRef(() => {
    const draw = drawRef.current;
    const map = mapRef.current;
    const area = regionRef.current;
    if (!draw?.enabled || !map) return;
    draw.clear();
    setUnshowable(null);
    if (!area) return;
    const [result] = draw.addFeatures([
      { id: draw.getFeatureId(), type: "Feature", geometry: { type: "Polygon", coordinates: area.coordinates }, properties: { mode: "polygon" } },
    ]);
    if (result && !result.valid) {
      // The form still holds the points, and the server check says what's wrong.
      setUnshowable(result.reason ?? "unknown reason");
      return;
    }
    const bounds = ringsBounds(area.coordinates);
    if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 12 });
  });

  useEffect(() => {
    regionRef.current = region;
    if (region !== emittedRef.current) showRef.current();
  }, [region]);

  useEffect(() => {
    let map: MaplibreMap | null = null;
    let draw: TerraDraw | null = null;
    let cancelled = false;

    void (async () => {
      const maplibregl = await loadMaplibre();
      const { TerraDraw, TerraDrawPolygonMode } = await import("terra-draw");
      const { TerraDrawMapLibreGLAdapter } = await import("terra-draw-maplibre-gl-adapter");
      if (cancelled || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyle(),
        center: [-106.0, 39.0], // Colorado-ish; the user pans to their area
        zoom: 6,
      });
      mapRef.current = map;
      attachBasemapFallback(map);
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
        // Points typed before the map finished loading.
        if (regionRef.current) showRef.current();
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
          const drawn: DrawnPolygon = { type: "Polygon", coordinates: feature.geometry.coordinates as number[][][] };
          emittedRef.current = drawn;
          setUnshowable(null);
          onChangeRef.current(drawn);
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
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  function handleClear() {
    drawRef.current?.clear();
    emittedRef.current = null;
    setUnshowable(null);
    onChangeRef.current(null);
  }

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-[30rem] w-full overflow-hidden rounded-md border md:h-[40rem]"
        // Min height as a fallback if the utility class is purged in odd builds.
        style={{ minHeight: "20rem" }}
        role="region"
        aria-label="Map for drawing your service area. To enter it by keyboard, use the corner points table below the map."
      />
      {unshowable ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          The map can&apos;t show these points ({unshowable}). Check their order and that the edges don&apos;t cross.
        </p>
      ) : null}
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">
          Click to place points; click the first point to close the polygon. Draw a new one to
          replace it.
        </p>
        {region ? (
          <Button type="button" variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
