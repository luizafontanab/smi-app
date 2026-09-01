import { ImageResponse } from "next/og";

/** Home-screen icon — typographic monogram until real brand assets arrive. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0d10",
          color: "#fe5000",
          fontSize: 88,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 36,
        }}
      >
        SMI
      </div>
    ),
    { ...size }
  );
}
