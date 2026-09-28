/**
 * Chooses the local working subset of members for seed-real.ts.
 *
 * A blind slice would drop Salvagnini (breaking the featured machine), starve
 * whole industries so the industry bar and /industry/* pages have nothing, and
 * orphan any content picked separately — so members are chosen deliberately:
 * everything that must exist, then an even spread across industries,
 * preferring members with artwork so the directory and member pages render
 * something. Content selection then follows the members, not the other way
 * round.
 *
 * `--remote` runs seed everything and never call this.
 */
import { INDUSTRIES } from "./industries";

export type SelectableMember = {
  slug: string;
  status?: unknown;
  logo_path?: unknown;
  hero_path?: unknown;
};

/** Members that must survive the cut whatever the limit, and why. */
export const REQUIRED_MEMBER_SLUGS = [
  "salvagnini-uk-ireland", // owns the seeded featured machine
];

/** Minimum members per industry, so every industry page/filter has content. */
export const PER_INDUSTRY = 2;

export function selectMembers<T extends SelectableMember>(
  rows: T[],
  industryOf: (row: T) => string | null,
  limit: number,
  /** Stories + videos attributed to this member in the export. Members who own
   *  content are worth far more in a dev subset than members who don't: they
   *  are what make /news's "Member news" rail, the member page's story list and
   *  video attribution non-empty. Only 34 of the 123 real members own any. */
  contentCount: (row: T) => number = () => 0,
  /** Slugs that must survive the cut on top of REQUIRED_MEMBER_SLUGS — the
   *  legacy advertisers, whose adverts can't be imported without them
   *  (`adverts.member_id` is NOT NULL). Data-driven, so it follows the extract. */
  alsoRequired: readonly string[] = [],
): T[] {
  if (rows.length <= limit) return rows;

  const picked = new Set<string>();
  const keep = (r: T) => picked.add(r.slug);
  const dressed = (r: T) => (r.logo_path ? 2 : 0) + (r.hero_path ? 1 : 0);
  // Content first, then artwork: a member with stories earns its slot even
  // without a hero image.
  const rank = (a: T, b: T) => contentCount(b) - contentCount(a) || dressed(b) - dressed(a);

  // 1. Non-negotiable: the featured machine's member, any caller-required
  //    member, plus enough active members to back the three seeded member logins.
  for (const r of rows) if (REQUIRED_MEMBER_SLUGS.includes(r.slug) || alsoRequired.includes(r.slug)) keep(r);
  for (const r of rows.filter((r) => r.status === "active").slice(0, 3)) keep(r);

  // 2. Spread across industries. Ranking inside each bucket means the industry
  //    quota pulls in content-owning members too, instead of the two goals
  //    competing for the same slots.
  const byIndustry = new Map<string, T[]>();
  for (const r of rows) {
    const key = industryOf(r) ?? "(none)";
    const list = byIndustry.get(key);
    if (list) list.push(r);
    else byIndustry.set(key, [r]);
  }
  for (const list of byIndustry.values()) list.sort(rank);
  for (const industry of INDUSTRIES) {
    for (const r of (byIndustry.get(industry) ?? []).slice(0, PER_INDUSTRY)) {
      if (picked.size < limit) keep(r);
    }
  }

  // 3. Fill the remainder — remaining content owners first, then best-dressed,
  //    then anyone with an industry at all.
  const rest = rows
    .filter((r) => !picked.has(r.slug))
    .sort((a, b) => rank(a, b) || Number(Boolean(industryOf(b))) - Number(Boolean(industryOf(a))));
  for (const r of rest) {
    if (picked.size >= limit) break;
    keep(r);
  }

  return rows.filter((r) => picked.has(r.slug)); // keep the export's own order
}
