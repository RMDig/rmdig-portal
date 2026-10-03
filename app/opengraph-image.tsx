import { ImageResponse } from "next/og";

// The link-preview card for every page (Open Graph and Twitter), generated at
// build time. Plain text on a dark field: no fonts or assets to fetch.
export const alt = "AvAI by Rocky Mountain Digerati: check out with peace of mind";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4 }}>AvAI</div>
        <div style={{ fontSize: 52, marginTop: 16 }}>Check out with peace of mind</div>
        <div style={{ fontSize: 32, marginTop: 24, color: "#a3a3a3" }}>
          A safety companion for backcountry travel, and open snowpack research
        </div>
        <div style={{ fontSize: 28, marginTop: 56, color: "#a3a3a3" }}>rmdig.ai · Rocky Mountain Digerati</div>
      </div>
    ),
    size,
  );
}
