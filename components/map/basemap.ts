import type { StyleSpecification } from "maplibre-gl";

// The one basemap every portal map uses: free OpenStreetMap raster tiles, no
// API key. Fine for editors and overviews at this volume, but the OSM tile
// policy has no service guarantee and requires visible attribution, so every
// map keeps the attribution control on. Any future safety layer (alerts) needs
// a provider with a service guarantee instead (docs/plans/33 §2).
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
