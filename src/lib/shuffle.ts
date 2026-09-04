import { uniformShuffle } from "./adverts";

/**
 * Deterministic shuffling — same seed string in, same permutation out, in any
 * runtime. Built for the member directory's rotation (queries.ts
 * memberDirectory): the listing is shuffled so no member is stuck at the
 * bottom of the alphabet, but SQL-free pagination needs the order to hold
 * still between page loads, so the randomness is seeded rather than fresh.
 * The Fisher–Yates itself is adverts.ts's uniformShuffle, which already takes
 * a pluggable PRNG; this module only supplies the seeded one.
 */

/** 32-bit hash of an arbitrary seed string (xmur3-style mix + finaliser). */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 over the seed hash — tiny, uniform enough for display order. */
export function seededRand(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unbiased shuffle whose order is a pure function of the seed. Copies; never mutates. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  return uniformShuffle(items, seededRand(seed));
}
