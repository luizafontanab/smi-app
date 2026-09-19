/**
 * The seeded PRNG, on its own and importing nothing.
 *
 * It was part of ./shuffle, but that module imports uniformShuffle from
 * ./adverts, which reaches lib/db/server and its `server-only` guard — so a
 * client component could not touch the PRNG without dragging the Supabase
 * service client into the browser bundle. The member cloud (lib/cloud-layout)
 * needs exactly this function on both sides of the boundary, so it lives here
 * with no imports at all. ./shuffle re-exports it, so nothing else moved.
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
