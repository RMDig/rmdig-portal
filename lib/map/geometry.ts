// Pure geometry for the portal maps. GeoJSON order throughout: [lon, lat].

export type LonLat = [number, number];
export type Bounds = [LonLat, LonLat];

/** The bounding box of any set of rings, or null when there are no points. */
export function ringsBounds(rings: number[][][]): Bounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      const lon = p[0]!;
      const lat = p[1]!;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return minLon === Infinity ? null : [[minLon, minLat], [maxLon, maxLat]];
}

/** The union of several bounding boxes, or null when there are none. */
export function unionBounds(all: Array<Bounds | null>): Bounds | null {
  const present = all.filter((b): b is Bounds => b !== null);
  if (present.length === 0) return null;
  return ringsBounds(present.map((b) => [b[0], b[1]]));
}

/** A closed ring approximating a `miles`-radius circle around [lon, lat].
 *  Equirectangular degrees: accurate enough to draw; matching is done
 *  point-in-circle on the device, never against this polygon. */
export function circleRing(lon: number, lat: number, miles: number, steps = 64): LonLat[] {
  const km = miles * 1.609344;
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring: LonLat[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  ring.push(ring[0]!);
  return ring;
}
