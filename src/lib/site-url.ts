/**
 * The app's own public origin, for absolute URLs (sitemap, robots, canonical
 * and Open Graph tags).
 *
 * The chain matters. This used to fall back to the live WordPress domain,
 * which meant an unconfigured deploy published a sitemap of URLs pointing at
 * the old site — actively telling crawlers our content lives elsewhere.
 * Falling back to the deployment's own address is always safe: worst case it
 * is a vercel.app URL, which is simply true.
 *
 * - SITE_URL                        — set this once there is a real domain
 * - VERCEL_PROJECT_PRODUCTION_URL   — the project's stable production host,
 *                                     injected by Vercel (no scheme)
 * - VERCEL_URL                      — this specific deployment (preview builds)
 * - localhost:3100                  — dev
 *
 * Read at request time, not inlined, so changing SITE_URL needs no rebuild.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  return "http://localhost:3100";
}
