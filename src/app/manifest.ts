import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sheet Metal Industries",
    short_name: "SMI",
    description:
      "The voice of the UK sheet metal, fabrication and welding trade: industry news, member companies, machinery and events.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#0b0d10",
    icons: [{ src: "/apple-icon", sizes: "180x180", type: "image/png" }],
  };
}
