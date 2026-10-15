/**
 * Directory filter narrowing (GAPS A9.1, USE-CASES gap 20).
 *
 * The bug: picking a membership type on /member left every Services and
 * Industry option on offer, so a reader could stack filters into a guaranteed
 * empty result. There is no curated type → service mapping to narrow by —
 * the only taxonomy mapping in the repo (`scripts/lib/industry-map.ts`) is a
 * one-off industry backfill, not a live rule — so this narrows by *facets*
 * instead: an option stays on offer only if at least one member matching the
 * other filters actually has it.
 * That needs nothing from anyone and can never promise a match that isn't there.
 *
 * Each axis is faceted against the *other* axes only. Faceting services
 * against the services already picked would hide every alternative the moment
 * one is ticked, and within an axis the filter is OR — ticking a second
 * service widens the result, so its options must stay visible.
 *
 * Pure, so the matching rule is tested directly; `memberFacets()` in
 * queries.ts does the fetching.
 */

export type FacetMember = {
  /** Every industry the member is in (member_industries), not just the primary. */
  industries: ReadonlySet<string>;
  services: ReadonlySet<string>;
  types: ReadonlySet<string>;
};

export type FacetSelection = {
  industries: readonly string[];
  services: readonly string[];
  membershipTypes: readonly string[];
};

export type Facets = {
  industries: Set<string>;
  services: Set<string>;
  membershipTypes: Set<string>;
};

type Axis = keyof FacetSelection;

/**
 * The same rule memberFilterIds applies in SQL: OR within an axis, AND across
 * axes, and an axis with nothing picked doesn't filter. `skip` leaves one axis
 * out, which is what makes each facet independent of its own selection.
 */
function matches(m: FacetMember, sel: FacetSelection, skip: Axis): boolean {
  if (skip !== "industries" && sel.industries.length && !sel.industries.some((i) => m.industries.has(i))) return false;
  if (skip !== "services" && sel.services.length && !sel.services.some((s) => m.services.has(s))) return false;
  if (skip !== "membershipTypes" && sel.membershipTypes.length && !sel.membershipTypes.some((t) => m.types.has(t))) return false;
  return true;
}

export function computeFacets(members: readonly FacetMember[], sel: FacetSelection): Facets {
  const facets: Facets = { industries: new Set(), services: new Set(), membershipTypes: new Set() };
  for (const m of members) {
    if (matches(m, sel, "industries")) m.industries.forEach((i) => facets.industries.add(i));
    if (matches(m, sel, "services")) m.services.forEach((s) => facets.services.add(s));
    if (matches(m, sel, "membershipTypes")) m.types.forEach((t) => facets.membershipTypes.add(t));
  }
  return facets;
}

/**
 * Narrow an option list to its facet, always keeping what is already selected:
 * a selected option that matches nothing must stay visible, or the reader has
 * no way to untick it.
 */
export function narrowOptions<T extends { slug: string }>(options: readonly T[], available: ReadonlySet<string> | null, selected: readonly string[]): T[] {
  if (!available) return [...options];
  return options.filter((o) => available.has(o.slug) || selected.includes(o.slug));
}
