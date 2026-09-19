import { uniformShuffle } from "./adverts";
import { seededRand } from "./seeded-rand";

/**
 * Deterministic shuffling — same seed string in, same permutation out, in any
 * runtime. Built for the member directory's rotation (queries.ts
 * memberDirectory): the listing is shuffled so no member is stuck at the
 * bottom of the alphabet, but SQL-free pagination needs the order to hold
 * still between page loads, so the randomness is seeded rather than fresh.
 * The Fisher–Yates itself is adverts.ts's uniformShuffle, which already takes
 * a pluggable PRNG; the seeded PRNG is ./seeded-rand, which is kept separate
 * (and import-free) so client components can use it without pulling this
 * module's server-only dependency chain into the browser.
 */

export { seededRand };

/** Unbiased shuffle whose order is a pure function of the seed. Copies; never mutates. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  return uniformShuffle(items, seededRand(seed));
}
