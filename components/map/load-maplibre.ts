import type * as MapLibre from "maplibre-gl";

// The one way the portal's map components load MapLibre in the browser.
//
// maplibre-gl v6 is ESM-only and runs its tile worker from a separate file,
// maplibre-gl-worker.mjs. On its own it looks for that file next to
// `import.meta.url`, which inside a Turbopack chunk is the chunk's URL, so the
// worker 404s ("Worker failed to load") and no map renders. Per MapLibre's
// bundler guidance, `new URL(<package path>, import.meta.url)` makes Next.js emit
// the worker as a hashed static asset and hands us its URL; it has to be set
// once, before the first Map is constructed.
let loading: Promise<typeof MapLibre> | null = null;

export function loadMaplibre(): Promise<typeof MapLibre> {
  loading ??= import("maplibre-gl").then((maplibregl) => {
    maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
    return maplibregl;
  });
  return loading;
}
