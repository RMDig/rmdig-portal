"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { GeoJSONSource, Map as MaplibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { OSM_STYLE } from "@/components/map/basemap";
import { circleRing } from "@/lib/map/geometry";

// A radius ad target's editable geometry: a draggable center pin + a mileage circle
// (AD-P7b, AvApp doc 31 §3 Tier 1). The slider that sets `mi` lives in the parent
// TargetPicker; this map renders the pin and the circle and reports pin moves up.
// Reuses the same MapLibre + free OSM raster basemap as components/map/RegionDrawMap
// (no API key, fine at this volume). MapLibre touches `window` at construction, so it
// is dynamically imported inside the effect to stay out of SSR.

interface RadiusMapProps {
  lat: number;
  lon: number;
  mi: number;
  onCenterChange: (lat: number, lon: number) => void;
}


const CIRCLE_SOURCE = "radius-circle";

function circlePolygon(lon: number, lat: number, miles: number) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [circleRing(lon, lat, miles)] },
  };
}

export default function RadiusMap({ lat, lon, mi, onCenterChange }: RadiusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const loadedRef = useRef(false);
  // Latest values in refs so the init effect can stay []-deps and event handlers read
  // current props without re-subscribing.
  const onChangeRef = useRef(onCenterChange);
  const stateRef = useRef({ lat, lon, mi });
  useEffect(() => {
    onChangeRef.current = onCenterChange;
    stateRef.current = { lat, lon, mi };
  });

  // One-time map + marker + circle setup.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (cancelled || !containerRef.current) return;

      const { lat: lat0, lon: lon0, mi: mi0 } = stateRef.current;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_STYLE,
        center: [lon0, lat0],
        zoom: 6,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");

      const marker = new maplibregl.Marker({ draggable: true, color: "#2563eb" })
        .setLngLat([lon0, lat0])
        .addTo(map);
      markerRef.current = marker;

      const reportAndRedraw = () => {
        const { lng, lat: mLat } = marker.getLngLat();
        const src = map.getSource(CIRCLE_SOURCE) as GeoJSONSource | undefined;
        src?.setData(circlePolygon(lng, mLat, stateRef.current.mi));
        onChangeRef.current(mLat, lng);
      };
      marker.on("drag", reportAndRedraw);
      marker.on("dragend", reportAndRedraw);
      // Click the map to move the pin there.
      map.on("click", (e) => {
        marker.setLngLat(e.lngLat);
        reportAndRedraw();
      });

      map.on("load", () => {
        if (cancelled) return;
        map.addSource(CIRCLE_SOURCE, {
          type: "geojson",
          data: circlePolygon(lon0, lat0, mi0),
        });
        map.addLayer({
          id: "radius-fill",
          type: "fill",
          source: CIRCLE_SOURCE,
          paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 },
        });
        map.addLayer({
          id: "radius-line",
          type: "line",
          source: CIRCLE_SOURCE,
          paint: { "line-color": "#2563eb", "line-width": 2 },
        });
        loadedRef.current = true;
      });
    })();

    return () => {
      cancelled = true;
      loadedRef.current = false;
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw the circle when the mileage (or an externally-set center) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    markerRef.current?.setLngLat([lon, lat]);
    const src = map.getSource(CIRCLE_SOURCE) as GeoJSONSource | undefined;
    src?.setData(circlePolygon(lon, lat, mi));
  }, [lat, lon, mi]);

  return (
    <div
      ref={containerRef}
      className="h-80 w-full overflow-hidden rounded-md border"
      style={{ minHeight: "20rem" }}
      aria-label="Drag the pin to set your target's center; the circle shows the radius"
    />
  );
}
