import type { MetadataRoute } from "next";
import { publicDb } from "@/lib/db/server";
import { siteUrl } from "@/lib/site-url";

const BASE = siteUrl();

/** Every public section index. Kept beside the routes so a new one is one line. */
const SECTIONS: { path: string; changeFrequency?: "daily" | "weekly" | "monthly"; priority: number }[] = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/news", changeFrequency: "daily", priority: 0.9 },
  { path: "/member", changeFrequency: "weekly", priority: 0.8 },
  { path: "/video", changeFrequency: "weekly", priority: 0.7 },
  { path: "/event", changeFrequency: "weekly", priority: 0.7 },
  { path: "/newsletters", changeFrequency: "monthly", priority: 0.6 },
  { path: "/featured-machine", changeFrequency: "monthly", priority: 0.6 },
  { path: "/advertising", changeFrequency: "monthly", priority: 0.6 },
  { path: "/join", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.5 },
];

/**
 * Request-time, like every other DB-backed route. Two reasons: the approval
 * gate publishes stories continuously, so a sitemap frozen at deploy time is
 * wrong the moment an editor approves anything; and prerendering it made the
 * build itself depend on the database being reachable with valid credentials,
 * which is what turned a missing env var into a failed deploy.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = publicDb();
  const [stories, members, videos, events, newsletters, pages, industries] = await Promise.all([
    db.from("stories").select("slug, updated_at").eq("status", "published").limit(5000),
    // publicDb, so `public_read_active_members` already drops archived members
    // (20260923000002) — an archived member's URL leaves the sitemap with no
    // filter here. The status filter stays because the policy also serves
    // `grace`, which the directory does not list.
    db.from("members").select("slug").eq("status", "active"),
    db.from("videos").select("slug").eq("status", "published"),
    // no date filter: past events keep their pages, so they keep their entries
    db.from("events").select("slug").eq("status", "published"),
    db.from("newsletter_issues").select("web_slug").eq("status", "sent"),
    db.from("static_pages").select("slug, updated_at"),
    db.from("industries").select("slug"),
  ]);

  return [
    ...SECTIONS.map((s) => ({ url: `${BASE}${s.path}`, changeFrequency: s.changeFrequency, priority: s.priority })),
    ...(stories.data ?? []).map((s) => ({ url: `${BASE}/news/${s.slug}`, lastModified: s.updated_at, priority: 0.7 })),
    ...(members.data ?? []).map((m) => ({ url: `${BASE}/member/${m.slug}`, priority: 0.6 })),
    ...(videos.data ?? []).map((v) => ({ url: `${BASE}/video/${v.slug}`, priority: 0.5 })),
    ...(events.data ?? []).map((e) => ({ url: `${BASE}/event/${e.slug}`, priority: 0.5 })),
    ...(newsletters.data ?? []).map((n) => ({ url: `${BASE}/newsletters/${n.web_slug}`, priority: 0.4 })),
    ...(pages.data ?? []).map((p) => ({ url: `${BASE}/pages/${p.slug}`, lastModified: p.updated_at, priority: 0.4 })),
    ...(industries.data ?? []).map((c) => ({ url: `${BASE}/industry/${c.slug}`, changeFrequency: "daily" as const, priority: 0.6 })),
  ];
}
