import { ImageResponse } from "next/og";

/**
 * Site-wide fallback social card. twitter.card is declared
 * summary_large_image, but until this existed pages without their own cover
 * (home, every index, events, videos, static pages) shared with no image at
 * all. Typographic placeholder in brand colours — swap for real artwork when
 * the brand assets arrive (HUMAN-TODO §8).
 */
export const alt = "Sheet Metal Industries — UK sheet metal, fabrication & welding news";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          background: "#0b0d10",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>
          <span>Sheet Metal&nbsp;</span>
          <span style={{ color: "#ff8200" }}>Industries</span>
        </div>
        <div style={{ display: "flex", marginTop: 28, fontSize: 32, color: "#c9ced6" }}>
          The voice of the UK sheet metal, fabrication &amp; welding trade
        </div>
        <div style={{ display: "flex", marginTop: 60, width: 220, height: 10, background: "#ff8200" }} />
      </div>
    ),
    { ...size }
  );
}
