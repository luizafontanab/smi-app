/**
 * Pure — no server-only deps, so client components (the video editor's live
 * preview) can import it without pulling `server-only` into the client bundle
 * transitively through lib/hero.ts.
 */

/** Same extraction the video cards have always used — watch?v=<id>. */
export function youtubeId(url: string): string | null {
  return url.match(/[?&]v=([\w-]+)/)?.[1] ?? null;
}
