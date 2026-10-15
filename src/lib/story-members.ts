import type { serviceDb } from "@/lib/db/server";
import { isMemberLinkable } from "@/lib/member-visibility";
import { UUID_RE } from "@/lib/validate";

type Db = ReturnType<typeof serviceDb>;

/**
 * Several members per story (Jas 13/10 item 12). `story_members` holds every
 * member a story features, PRIMARY INCLUDED (migration 20261015000003);
 * `stories.member_id` stays the primary — who the story leads with and who
 * owns it. These helpers keep the two in step, the way member-services keeps
 * members.industry_id inside member_industries.
 */

/**
 * The console's pick → the full tagged set, primary first. Extras without a
 * primary are refused: the primary is who owns the story and whose tile
 * leads, so it can't be left for the order of a checkbox list to decide.
 */
export function resolveStoryMembers(
  primaryId: string | null,
  extraIds: readonly string[],
): { ids: string[] } | { error: string } {
  const extras = [...new Set(extraIds.filter((id) => UUID_RE.test(id)))].filter((id) => id !== primaryId);
  if (!primaryId) {
    return extras.length ? { error: "Choose the subject member before tagging other members." } : { ids: [] };
  }
  if (!UUID_RE.test(primaryId)) return { error: "That subject member isn't valid." };
  return { ids: [primaryId, ...extras] };
}

/** Replace a story's tagged members with exactly `ids` (delete-then-insert, as replaceMemberIndustries). */
export async function replaceStoryMembers(db: Db, storyId: string, ids: readonly string[]) {
  const { error } = await db.from("story_members").delete().eq("story_id", storyId);
  if (error) throw error;
  if (!ids.length) return;
  const { error: insertError } = await db
    .from("story_members")
    .insert([...new Set(ids)].map((member_id) => ({ story_id: storyId, member_id })));
  if (insertError) throw insertError;
}

export type TaggedMember = {
  id: string;
  slug: string;
  name: string;
  logo_path: string | null;
  website: string | null;
  social: unknown;
  status: string;
  archived_at: string | null;
};

/**
 * Every member a story features, primary first, then by name. Read from
 * story_members (one FK to members, so a bare embed is unambiguous) rather than
 * as a members embed on stories, which stories_member_id_fkey has to
 * disambiguate (tests/unit/story-member-embed). Selects status and archived_at:
 * callers decide linkability with isMemberLinkable, and with the service role
 * RLS isn't doing that for them.
 */
export async function taggedMembers(db: Db, storyId: string, primaryId: string | null): Promise<TaggedMember[]> {
  const { data } = await db
    .from("story_members")
    .select("member:members(id, slug, name, logo_path, website, social, status, archived_at)")
    .eq("story_id", storyId);
  const members = (data ?? []).map((r) => r.member).filter(Boolean) as TaggedMember[];
  return members.sort((a, b) =>
    a.id === primaryId ? -1 : b.id === primaryId ? 1 : a.name.localeCompare(b.name),
  );
}

type Enqueue = (kind: "notify_member", payload: Record<string, unknown>) => Promise<unknown>;

/**
 * "Your story is live" when a story publishes, for every member it features:
 * the primary gets story_live as before; each co-tagged member gets
 * story_featured ("a story featuring you is live"). Co-tagged members who are
 * archived or no longer public are skipped — their tile isn't on the page, so
 * there's nothing for them to go and see. The enqueue is passed in so this
 * module stays free of the job runner (which imports it back).
 */
export async function enqueueStoryLive(db: Db, story: { id: string; member_id: string | null }, enqueue: Enqueue) {
  if (story.member_id) await enqueue("notify_member", { member_id: story.member_id, kind: "story_live", story_id: story.id });
  const members = await taggedMembers(db, story.id, story.member_id);
  for (const m of members) {
    if (m.id === story.member_id || !isMemberLinkable(m)) continue;
    await enqueue("notify_member", { member_id: m.id, kind: "story_featured", story_id: story.id });
  }
}
