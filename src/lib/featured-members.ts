/**
 * Sold featured-member placements as the members to show, each once: a member
 * can hold overlapping placements, so they are deduplicated on slug. It
 * doubles as the null-member filter, since placements.member_id is nullable.
 * Used by the home page's featured box and the directory's featured strip.
 */
export function uniqueFeaturedMembers<M extends { slug: string }>(placements: readonly { member: M | null }[]): M[] {
  return [...new Map(placements.flatMap((p) => (p.member ? [[p.member.slug, p.member] as const] : []))).values()];
}
