import { serviceDb } from "./db/server";

export type ActivityEntry = { when: string; what: string };

/**
 * Renewal-call timeline (A18): stories, placements, invoices, notifications,
 * advert clicks and newsletter appearances, merged and sorted. Shared by the
 * console member editor (A5.8) and the CRM per-contact panel (A5.9) so the
 * merge exists in exactly one place.
 */
export async function memberActivityTimeline(memberId: string, limit = 15): Promise<ActivityEntry[]> {
  const db = serviceDb();

  const [stories, allStories, placements, invoices, notifications, adverts] = await Promise.all([
    db.from("stories").select("title, published_at").eq("member_id", memberId).eq("status", "published").order("published_at", { ascending: false }).limit(10),
    db.from("stories").select("id").eq("member_id", memberId).eq("status", "published"),
    db.from("placements").select("kind, starts_on").eq("member_id", memberId).order("starts_on", { ascending: false }).limit(5),
    db.from("invoices").select("number, issued_on, status").eq("member_id", memberId).order("issued_on", { ascending: false }).limit(5),
    db.from("notifications").select("kind, created_at").eq("member_id", memberId).order("created_at", { ascending: false }).limit(5),
    db.from("adverts").select("id, name").eq("member_id", memberId),
  ]);

  const storyIds = (allStories.data ?? []).map((s) => s.id);
  const advertIds = (adverts.data ?? []).map((a) => a.id);
  const advertName = new Map((adverts.data ?? []).map((a) => [a.id, a.name] as const));

  const [adClicks, appearances] = await Promise.all([
    advertIds.length
      ? db.from("analytics_events").select("occurred_at, advert_id").eq("kind", "ad_click").in("advert_id", advertIds).order("occurred_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as { occurred_at: string; advert_id: string | null }[] }),
    storyIds.length
      ? db
          .from("newsletter_items")
          .select("issue:newsletter_issues!inner(number, sent_at, status)")
          .in("story_id", storyIds)
          .eq("issue.status", "sent")
          .order("sent_at", { foreignTable: "issue", ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as { issue: { number: number; sent_at: string | null; status: string } }[] }),
  ]);

  const timeline: ActivityEntry[] = [
    ...(stories.data ?? []).map((s) => ({ when: s.published_at ?? "", what: `Story published: ${s.title}` })),
    ...(placements.data ?? []).map((p) => ({ when: p.starts_on, what: `Placement: ${p.kind.replace("_", " ")}` })),
    ...(invoices.data ?? []).map((i) => ({ when: i.issued_on, what: `Invoice ${i.number} (${i.status})` })),
    ...(notifications.data ?? []).map((n) => ({ when: n.created_at, what: `Notified: ${n.kind}` })),
    ...(adClicks.data ?? []).map((e) => ({ when: e.occurred_at, what: `Advert clicked: ${advertName.get(e.advert_id ?? "") ?? "advert"}` })),
    ...(appearances.data ?? []).map((a) => ({ when: a.issue.sent_at ?? "", what: `Featured in newsletter issue ${a.issue.number}` })),
  ];

  return timeline.sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, limit);
}
