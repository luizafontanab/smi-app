import { siteUrl } from "../site-url";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../upload-limits";

/**
 * The one network call the story-sources watcher makes. Never throws: a
 * source that times out or refuses us is an outcome to record on the source,
 * not an error for the job runner to retry.
 *
 * The user agent says who we are and where to find us. Sites that block
 * non-browser clients are left blocked — they are listed as "blocked" on
 * /console/sources and in docs/story-sources.md, never worked around.
 */

export type Fetched = { ok: boolean; status: number; body: string; finalUrl: string; error?: string };

const TIMEOUT_MS = 15_000;
/** Feeds and listing pages are small; a multi-megabyte body is something else. */
const MAX_BODY_CHARS = 3_000_000;

export function userAgent(): string {
  return `SMI-story-sources/1.0 (+${siteUrl()})`;
}

export async function fetchText(url: string, accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"): Promise<Fetched> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: accept },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.text()).slice(0, MAX_BODY_CHARS);
    return { ok: res.ok, status: res.status, body, finalUrl: res.url || url };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    const error = err.name === "AbortError" ? "timed out" : err.cause?.code ?? err.message;
    return { ok: false, status: 0, body: "", finalUrl: url, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An article's main image, for "Start story" to use as the cover. Returns
 * null on anything but a reasonably sized image response: the draft simply
 * has no cover then. The bytes are checked again (and normalised) by
 * uploadImage — the declared type here is only a cheap first refusal.
 */
export async function fetchImage(url: string): Promise<File | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9" },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!res.ok || !ALLOWED_IMAGE_TYPES[type]) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null;
    return new File([bytes], `cover.${ALLOWED_IMAGE_TYPES[type]}`, { type });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
