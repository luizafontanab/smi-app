import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/console", "/member", "/login", "/visit/"] }],
    sitemap: `${process.env.SITE_URL ?? "https://sheetmetalindustries.com"}/sitemap.xml`,
  };
}
