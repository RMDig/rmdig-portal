import type { Glyph, ItemGroup, LegendEntry } from "@/lib/map/layers";

// The legend's pictures, drawn the way the map draws each shape: a filled
// dot, a hollow dot, an accuracy or target ring, a route line, an area.
export function GlyphIcon({ glyph, color, dashed }: { glyph: Glyph; color: string; dashed: boolean }) {
  const dash = dashed ? "3 2" : undefined;
  return (
    <svg aria-hidden width="20" height="14" viewBox="0 0 20 14" className="shrink-0">
      {glyph === "dot" ? <circle cx="10" cy="7" r="4.5" fill={color} stroke="#ffffff" strokeWidth="1.5" /> : null}
      {glyph === "hollow-dot" ? <circle cx="10" cy="7" r="4" fill="#ffffff" stroke={color} strokeWidth="2" /> : null}
      {glyph === "ring" ? (
        <circle cx="10" cy="7" r="5.5" fill={color} fillOpacity={0.18} stroke={color} strokeWidth="1.75" strokeDasharray={dash} />
      ) : null}
      {glyph === "line" ? (
        <path d="M1 11 L7 4 L13 9 L19 3" fill="none" stroke={color} strokeWidth="2" strokeDasharray={dash} strokeLinejoin="round" />
      ) : null}
      {glyph === "area" ? (
        <rect x="2" y="2" width="16" height="10" rx="1.5" fill={color} fillOpacity={0.18} stroke={color} strokeWidth="1.75" strokeDasharray={dash} />
      ) : null}
    </svg>
  );
}

/** How a list row pictures its item. */
export const GROUP_GLYPH: Record<ItemGroup, Glyph> = {
  "open-alert": "dot",
  "closed-alert": "hollow-dot",
  area: "area",
  target: "ring",
};

export function MapLegend({ entries }: { entries: LegendEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="map-legend" className="space-y-1.5">
      <h2 id="map-legend" className="font-medium">
        Legend
      </h2>
      <ul className="space-y-1">
        {entries.map((e) => (
          <li key={`${e.glyph}|${e.color}|${e.dashed}|${e.label}`} className="text-muted-foreground flex items-center gap-2 text-xs">
            <GlyphIcon glyph={e.glyph} color={e.color} dashed={e.dashed} />
            {e.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
