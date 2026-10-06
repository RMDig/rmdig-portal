import type { StyleSpecification } from "maplibre-gl";

// The one basemap every portal map uses (docs/plans/33 §2).
//
// With NEXT_PUBLIC_MAPTILER_KEY set (production): MapTiler Outdoor, a
// commercial provider with a service agreement and a data-processing
// agreement, with contours and hillshade for terrain. The team alert map is
// safety-adjacent, so it shouldn't rest on a volunteer tile service. The key
// is public by design (the browser sends it with every tile request); it is
// locked to our origins in the MapTiler dashboard.
//
// Without it (local dev, previews without a key): the free OpenStreetMap
// raster tiles, which have no service guarantee and are fine for that.
// Either way the attribution control stays on.
export const OSM_STYLE: StyleSpecification = {
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

const MAPTILER_STYLE = "https://api.maptiler.com/maps/outdoor-v2/style.json";

/** The basemap for a MapLibre map: MapTiler's style URL, or OSM. Read in the
 *  browser; Next inlines NEXT_PUBLIC_* at build time. */
export function basemapStyle(): StyleSpecification | string {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  return key ? `${MAPTILER_STYLE}?key=${encodeURIComponent(key)}` : OSM_STYLE;
}

/** If the MapTiler style can't load (bad or revoked key, MapTiler down), fall
 *  back to OpenStreetMap instead of leaving the map unloaded. An unloaded map
 *  never adds our layers, so a team would see no alerts on it at all, which is
 *  worse than a plainer basemap. Reported to Sentry so the key gets fixed. */
export function attachBasemapFallback(map: {
  once: (type: "error", listener: (e: { error?: Error }) => void) => unknown;
  isStyleLoaded: () => boolean | void;
  setStyle: (style: StyleSpecification) => unknown;
}): void {
  if (typeof basemapStyle() === "object") return;
  map.once("error", (e) => {
    if (map.isStyleLoaded()) return;
    console.error("basemap: MapTiler style failed to load, falling back to OpenStreetMap", e.error);
    void import("@sentry/nextjs").then((Sentry) =>
      Sentry.captureException(e.error ?? new Error("MapTiler style failed to load"), { tags: { event: "basemap.fallback" } }),
    );
    map.setStyle(OSM_STYLE);
  });
}
