import type { MetadataRoute } from "next";
import { publicDb } from "@/lib/db/server";

const BASE = process.env.SITE_URL ?? "https://sheetmetalindustries.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = publicDb();
  const [{ data: stories }, { data: members }] = await Promise.all([
    db.from("stories").select("slug, updated_at").eq("status", "published").limit(5000),
    db.from("members").select("slug").eq("status", "active"),
  ]);
  return [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/news`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/members`, changeFrequency: "weekly", priority: 0.8 },
    ...(stories ?? []).map((s) => ({ url: `${BASE}/news/${s.slug}`, lastModified: s.updated_at, priority: 0.7 })),
    ...(members ?? []).map((m) => ({ url: `${BASE}/members/${m.slug}`, priority: 0.6 })),
  ];
}
