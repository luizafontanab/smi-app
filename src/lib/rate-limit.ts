import { headers } from "next/headers";

/**
 * Fixed-window limiter for the unauthenticated write paths (contact form,
 * newsletter signup, join). Those actions insert straight into Postgres with
 * the service key and had nothing in front of them.
 *
 * SCOPE, honestly: this is per-instance memory. On Vercel a burst from one
 * caller usually lands on the same warm lambda, so it blunts naive flooding,
 * but a distributed flood or a cold-start-heavy period will leak through. It
 * is a floor, not a guarantee — a shared store (Postgres table or Upstash) is
 * the real fix if abuse ever materialises. Deliberately no dependency and no
 * migration for now: the traffic does not justify either yet.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED = 10_000;

/** Drop expired entries so a long-lived instance can't grow unbounded. */
function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Returns true when the caller is within budget, false when it should be
 * refused. Call once per attempt — it counts.
 */
export function withinLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_TRACKED) sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

/**
 * Caller identity for limiting. `x-forwarded-for`'s first entry is the client
 * as far as Vercel's proxy is concerned; it is spoofable in general but not
 * behind Vercel, which rewrites it.
 *
 * Returns null when there is no request to attribute — headers() throws
 * outside a request scope, which is the case in unit tests and in scripts that
 * import an action directly. Nothing to rate-limit there, and a limiter must
 * never be the reason a server action cannot be called.
 */
export async function callerKey(scope: string): Promise<string | null> {
  try {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    return `${scope}:${ip}`;
  } catch {
    return null;
  }
}

/** Convenience: one call for the common "limit this action by IP" case. */
export async function allowRequest(scope: string, limit: number, windowMs: number): Promise<boolean> {
  const key = await callerKey(scope);
  if (key === null) return true;
  return withinLimit(key, limit, windowMs);
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
