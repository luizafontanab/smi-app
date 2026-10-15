import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    // /visit/ and /go/ are the click-throughs (advert and member contact
    // links): each GET counts a click, so crawlers are kept out of both —
    // and the routes skip counting for the ones that ignore this (lib/bots).
    rules: [{ userAgent: "*", allow: "/", disallow: ["/console", "/dashboard", "/login", "/visit/", "/go/", "/api/", "/preview/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
