/**
 * verify-import's story ↔ member check, as a pure function so it can be tested.
 *
 * It used to compare one number: story_members rows on imported stories
 * against the export's member_wp_ids, which had to match exactly. That was only
 * ever true on the day of the import. Since then admins re-tag stories
 * (replaceStoryMembers, Jas 13/10 item 12) and migration 20261015000003 — and
 * the seed — add a story's primary member when the export left it out, so a
 * perfectly healthy production database reads ✗ for good.
 *
 * What the import has to have delivered is narrower, and per story: every
 * member the export tagged is still tagged (a SUBSET, not equality — extra
 * tags are editorial, not a fault), and the story's primary member is among its
 * tags (the 20261015000003 invariant). An export member that never made it into
 * the database can't be tagged; those are counted on their own, so a member
 * shortfall isn't misreported as a tagging one.
 */

export type ExportStory = { slug: string; wp_member_id: number | null; member_wp_ids?: number[] };
export type LiveStory = { id: string; slug: string; member_id: string | null };
export type StoryMemberLink = { story_id: string; member_id: string };

export type StoryMemberShortfall = {
  /** Export stories found in the database, i.e. the ones this check could look at. */
  checked: number;
  /** Stories missing at least one member the export tagged them with. */
  untagged: { slug: string; missingWpIds: number[] }[];
  /** Stories whose primary (stories.member_id) is not among their tags. */
  primaryMissing: string[];
  /** Export member ids with no member in the database — counted, not blamed on tagging. */
  absentMembers: number[];
};

export function storyMemberShortfall(
  exportStories: ExportStory[],
  liveStories: LiveStory[],
  links: StoryMemberLink[],
  memberIdByWp: ReadonlyMap<number, string>,
): StoryMemberShortfall {
  const liveBySlug = new Map(liveStories.map((s) => [s.slug, s]));
  const tagsOf = new Map<string, Set<string>>();
  for (const l of links) {
    const set = tagsOf.get(l.story_id);
    if (set) set.add(l.member_id);
    else tagsOf.set(l.story_id, new Set([l.member_id]));
  }

  const out: StoryMemberShortfall = { checked: 0, untagged: [], primaryMissing: [], absentMembers: [] };
  const absent = new Set<number>();
  for (const s of exportStories) {
    const live = liveBySlug.get(s.slug);
    if (!live) continue; // a missing story is the row counts' finding, not this one's
    out.checked++;
    const tags = tagsOf.get(live.id) ?? new Set<string>();
    const wpIds = [...new Set([...(s.wp_member_id != null ? [s.wp_member_id] : []), ...(s.member_wp_ids ?? [])])];
    const missingWpIds: number[] = [];
    for (const wp of wpIds) {
      const id = memberIdByWp.get(wp);
      if (!id) absent.add(wp);
      else if (!tags.has(id)) missingWpIds.push(wp);
    }
    if (missingWpIds.length) out.untagged.push({ slug: s.slug, missingWpIds });
    if (live.member_id && !tags.has(live.member_id)) out.primaryMissing.push(s.slug);
  }
  out.absentMembers = [...absent].sort((a, b) => a - b);
  return out;
}
