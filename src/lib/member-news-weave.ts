import { uniformShuffle } from "./adverts";

/**
 * Member News in the grid homepage's top carousel (GAPS A9.3, REQUIREMENTS §3,
 * 18 Sep): paying members' news had only ever appeared at the foot of the page.
 * It now rotates through the More News carousel near the top — tagged, because
 * the tiles already render MemberBadge off `is_member_news` — while the fuller
 * "Featured member news" band lower down stays as the secondary destination.
 *
 * Three rules, each from the spec rather than taste:
 *   · **The share stays small.** Keep roughly ≤20% member news (REQUIREMENTS
 *     §7). The fold shows `foldSize` stories (the two highlights plus the
 *     carousel), and member stories already in it by recency count first, so
 *     the woven ones only top up to `maxMember`. Two of ten is the 20%.
 *   · **Rotation is uniform and per request.** "Rotating on refresh" — no
 *     member is favoured and none is stuck out: a fair shuffle on every render
 *     (pages here render per request; there is no pagination whose order would
 *     need to hold still, unlike the directory's daily seed).
 *   · **Fixed, non-leading positions.** Woven items go to `positions` (never
 *     first), so the carousel still opens on the newest industry story and the
 *     layout doesn't change shape from load to load.
 *
 * Pure: returns the new carousel, never mutates. The carousel keeps its length —
 * a woven item displaces the oldest non-member tile, which is still on /news.
 */
export function weaveMemberNews<T extends { id: string; is_member_news: boolean }>(opts: {
  /** The carousel as recency would fill it. */
  carousel: T[];
  /** Stories shown above it in the same fold (the highlights) — for the share count and dedupe. */
  alsoInFold: T[];
  /** Candidate member stories, any order. */
  memberNews: T[];
  maxMember?: number;
  positions?: number[];
  rand?: () => number;
}): T[] {
  const { carousel, alsoInFold, memberNews, maxMember = 2, positions = [1, 4], rand = Math.random } = opts;
  const inFold = [...alsoInFold, ...carousel];
  const already = inFold.filter((s) => s.is_member_news).length;
  const room = Math.max(0, Math.min(maxMember - already, positions.length));
  if (room === 0 || carousel.length === 0) return [...carousel];

  const shown = new Set(inFold.map((s) => s.id));
  const picks = uniformShuffle(memberNews.filter((s) => s.is_member_news && !shown.has(s.id)), rand).slice(0, room);
  if (picks.length === 0) return [...carousel];

  // Make room by dropping the oldest non-member tiles, keeping member ones.
  const out = [...carousel];
  for (let dropped = 0, i = out.length - 1; dropped < picks.length && i >= 0; i--) {
    if (!out[i].is_member_news) {
      out.splice(i, 1);
      dropped++;
    }
  }
  picks.forEach((story, k) => out.splice(Math.min(positions[k], out.length), 0, story));
  return out.slice(0, carousel.length);
}
