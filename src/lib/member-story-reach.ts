import type { serviceDb } from "@/lib/db/server";

type Db = ReturnType<typeof serviceDb>;

/**
 * A member's story views for /dashboard/stats, counted in the database by
 * member_story_view_count / member_story_view_months (migration
 * 20261016000022, where the rule is set out in full). In short: a view counts
 * for a member who was the story's primary when it was read, or whom the story
 * features now — never filtered by the story's current status, so the desk
 * unpublishing a story no longer takes views off the "all time" figure, and no
 * list of story ids rides in the request URL.
 *
 * A failed call reads as zero rather than failing the page, like every other
 * figure there; the transport logger in lib/db/server already reports it.
 */
export async function memberStoryViewCount(db: Db, memberId: string, since?: string): Promise<number> {
  const { data } = await db.rpc("member_story_view_count", { p_member: memberId, ...(since ? { p_since: since } : {}) });
  return Number(data ?? 0);
}

/** Month-by-month views since `sinceDay`, as one row per month dated the 1st — the shape the page's month buckets read. */
export async function memberStoryViewMonths(db: Db, memberId: string, sinceDay: string): Promise<{ day: string; count: number }[]> {
  const { data } = await db.rpc("member_story_view_months", { p_member: memberId, p_since: sinceDay });
  return (data ?? []).map((r) => ({ day: `${r.month}-01`, count: Number(r.n) }));
}
