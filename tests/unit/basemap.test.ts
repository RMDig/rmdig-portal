import { afterEach, describe, expect, it, vi } from "vitest";

import { attachBasemapFallback, basemapStyle, OSM_STYLE } from "@/components/map/basemap";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

afterEach(() => {
  delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
  vi.restoreAllMocks();
});

function fakeMap(styleLoaded: boolean) {
  const handlers: Array<(e: { error?: Error }) => void> = [];
  return {
    once: vi.fn((_t: "error", fn: (e: { error?: Error }) => void) => handlers.push(fn)),
    isStyleLoaded: () => styleLoaded,
    setStyle: vi.fn(),
    fire: (e: { error?: Error }) => handlers.forEach((h) => h(e)),
  };
}

describe("basemapStyle", () => {
  it("uses MapTiler Outdoor when a key is set, and OpenStreetMap otherwise", () => {
    expect(basemapStyle()).toBe(OSM_STYLE);
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "abc&123";
    expect(basemapStyle()).toBe("https://api.maptiler.com/maps/outdoor-v2/style.json?key=abc%26123");
  });
});

describe("attachBasemapFallback", () => {
  it("switches to OpenStreetMap when the MapTiler style fails to load, so our layers still draw", () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "bad";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const map = fakeMap(false);
    attachBasemapFallback(map);
    map.fire({ error: new Error("403") });
    expect(map.setStyle).toHaveBeenCalledWith(OSM_STYLE);
  });

  it("leaves a loaded map alone (a later tile error isn't a style failure), and does nothing without a key", () => {
    process.env.NEXT_PUBLIC_MAPTILER_KEY = "good";
    const loaded = fakeMap(true);
    attachBasemapFallback(loaded);
    loaded.fire({ error: new Error("tile 404") });
    expect(loaded.setStyle).not.toHaveBeenCalled();
    delete process.env.NEXT_PUBLIC_MAPTILER_KEY;
    const osm = fakeMap(false);
    attachBasemapFallback(osm);
    expect(osm.once).not.toHaveBeenCalled();
  });
});
