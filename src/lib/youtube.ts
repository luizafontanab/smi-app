/**
 * Pure — no server-only deps, so client components (the video editor's live
 * preview) can import it without pulling `server-only` into the client bundle
 * transitively through lib/hero.ts.
 */

/** youtube.com and its m./music. mirrors, the privacy-mode embed host, and youtu.be. */
const YOUTUBE_HOST = /^(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/i;

/** Path forms that carry the id as their second segment: /shorts/<id>, /embed/<id>, … */
const ID_PATH = /^\/(?:shorts|embed|live|v)\/([^/]+)/;

/**
 * The video id from any YouTube link a person is likely to paste — watch?v=,
 * youtu.be/, /shorts/, /embed/, /live/ — or null. Only YouTube hosts count:
 * a `?v=` on some other site is not a YouTube video, and treating it as one
 * would embed an unrelated id. SMI accepts YouTube links only (USE-CASES gap
 * 23), so null is also what the save actions use to refuse a link.
 */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!YOUTUBE_HOST.test(u.hostname)) return null;
  const id = u.hostname.toLowerCase() === "youtu.be"
    ? u.pathname.split("/")[1]
    : u.searchParams.get("v") ?? u.pathname.match(ID_PATH)?.[1];
  return id && /^[\w-]+$/.test(id) ? id : null;
}

/** The message every save path shows when a link isn't one youtubeId() understands. */
export const YOUTUBE_ONLY_ERROR = "That doesn't look like a YouTube link. Paste the video's YouTube address — other sites aren't supported.";

/**
 * An optional YouTube field (a Featured Machine's video, GAPS A9.4): blank is
 * no video, a link youtubeId() can read is kept as typed, anything else is a
 * readable refusal — never a silent save of a link that will not embed.
 */
export function optionalYoutubeUrl(raw: FormDataEntryValue | null): { url: string | null } | { error: string } {
  const url = String(raw ?? "").trim();
  if (!url) return { url: null };
  return youtubeId(url) ? { url } : { error: YOUTUBE_ONLY_ERROR };
}
