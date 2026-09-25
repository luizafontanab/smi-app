import { serviceDb } from "@/lib/db/server";
import { isMemberLinkable } from "@/lib/member-visibility";
import type { ItemTarget, SlugMaps } from "@/lib/notification-links";

/**
 * Member notification read helpers.
 *
 * Own module rather than `queries.ts` on purpose: everything in there goes
 * through `publicDb()` so RLS is exercised on anonymous read paths, whereas a
 * notification is member-private. Same shape as `lib/submissions.ts` —
 * `serviceDb()` plus an explicit `member_id` filter, which is the ownership
 * check. There *is* a `member_read_own_notifications` RLS policy
 * (20260808000004), but the dashboard already reads this table with the service
 * role, and one access pattern is easier to reason about than two.
 */
export async function unreadNotificationCount(memberId: string): Promise<number> {
  const { count } = await serviceDb()
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("member_id", memberId)
    .is("read_at", null);
  return count ?? 0;
}

type Payloaded = { kind: string; payload: unknown };

/**
 * The slugs a page of notifications needs to link to what each one is about.
 *
 * One query per content type for the whole page, rather than a lookup per row —
 * a notification list is a read-only widget and must not fan out into dozens of
 * round trips. Only ids that actually appear are fetched, so a page of purely
 * billing notifications makes no content queries at all.
 *
 * Status rides along with the slug because an old notification outlives the
 * state it was written about: `notificationHref` needs to know where the item
 * has got to, not only what it is called. An id that comes back with no row is
 * left out of the map, which that function reads as "gone".
 */
export async function notificationSlugs(rows: Payloaded[], memberId: string): Promise<SlugMaps> {
  const collect = (key: string) => [
    ...new Set(
      rows
        .map((r) => (r.payload as Record<string, unknown> | null)?.[key])
        .filter((v): v is string => typeof v === "string" && Boolean(v)),
    ),
  ];
  const storyIds = collect("story_id");
  const videoIds = collect("video_id");
  const eventIds = collect("event_id");

  const db = serviceDb();
  type Row = { id: string; slug: string; status: string };
  const byId = (data: Row[] | null): Record<string, ItemTarget> =>
    Object.fromEntries((data ?? []).map((r) => [r.id, { slug: r.slug, status: r.status }]));
  const none = Promise.resolve({ data: [] as Row[] });

  const [stories, videos, events, member] = await Promise.all([
    storyIds.length ? db.from("stories").select("id, slug, status").in("id", storyIds) : none,
    videoIds.length ? db.from("videos").select("id, slug, status").in("id", videoIds) : none,
    eventIds.length ? db.from("events").select("id, slug, status").in("id", eventIds) : none,
    // status + archived_at, not just slug: this is serviceDb(), so RLS does not
    // filter it, and a notification linking a member to their own page must not
    // point at a 404 once that page is archived or lapsed (fix-list 72). A
    // missing link is the deliberate behaviour here — see notification-links.ts,
    // which already prefers no link over a guessed one.
    db.from("members").select("slug, status, archived_at").eq("id", memberId).maybeSingle(),
  ]);

  return {
    stories: byId(stories.data),
    videos: byId(videos.data),
    events: byId(events.data),
    member: isMemberLinkable(member.data) ? member.data.slug : null,
  };
}
