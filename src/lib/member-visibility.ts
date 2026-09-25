/**
 * One predicate for "does this member get a public byline and a link to their
 * page" (fix list 72).
 *
 * Four pages render a member credit under someone else's content — a story, a
 * video, an event, the featured machine — and each had grown its own idea of
 * when to render it: /news gated on `status`, the other three only on the
 * member embed being non-null. That is one rule expressed four ways, and the
 * archive flag was about to make it five.
 *
 * THE RULE. A member is linkable when they are not archived and their status is
 * one the public site serves. Both halves match `memberBySlug`, which is what
 * the link points at — anything else renders a link to a 404.
 *
 * WHY THE FIELDS ARE OPTIONAL. Which columns a caller holds depends on which
 * client read the row, and that is exactly the distinction that matters:
 *
 *   - `publicDb()` reads run as `anon`, so `public_read_active_members`
 *     (20260923000002) has already applied *both* halves in the database — an
 *     archived or lapsed member comes back as a null embed, never as a row with
 *     a disqualifying value. Those projections (VIDEO_CARD, EVENT_FIELDS) do
 *     not select `status` or `archived_at` at all, and for them this call is
 *     really the null check, with the database as the enforcement point.
 *   - `serviceDb()` reads bypass RLS entirely, so they must select both columns
 *     and let this function do the work. `activePlacements` and
 *     `activeTakeover` do exactly that.
 *
 * So an absent field means "not selected, already enforced upstream" rather
 * than "unknown, assume the worst". A serviceDb() caller that forgets to select
 * the columns therefore gets no protection from this predicate — if you add
 * one, select `status, archived_at` on the member embed.
 */

/**
 * Member statuses with a live public page — the second half of the rule, and
 * the same list `public_read_active_members` enforces in the database.
 *
 * A literal tuple rather than `readonly string[]` so it can be handed straight
 * to PostgREST's `.in("status", …)`, which is typed to the `member_status`
 * enum. The Set below is what the predicate tests against, because `.includes`
 * on a tuple of literals rejects a plain `string` argument.
 */
export const PUBLIC_MEMBER_STATUSES = ["active", "grace"] as const;

const PUBLIC_STATUS_SET: ReadonlySet<string> = new Set(PUBLIC_MEMBER_STATUSES);

/**
 * A type predicate rather than a plain boolean so `{isMemberLinkable(x.member)
 * && <Link href={x.member.slug} />}` narrows the nullable embed in the same
 * expression that gates it.
 *
 * The constraint is `object` and the two fields are read through one cast
 * because the callers' row types genuinely differ (some carry neither column —
 * see above), and a structural parameter type made of nothing but optional
 * properties is a weak type: TypeScript rejects `{slug, name}` against it for
 * having no property in common, which is precisely the case this has to accept.
 */
export function isMemberLinkable<T extends object>(member: T | null | undefined): member is T {
  if (!member) return false;
  const { status, archived_at } = member as { status?: string | null; archived_at?: string | null };
  if (archived_at != null) return false;
  if (status != null && !PUBLIC_STATUS_SET.has(status)) return false;
  return true;
}
