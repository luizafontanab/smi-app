import { serviceDb } from "@/lib/db/server";

/**
 * What may land in the `media` bucket. The bucket is PUBLIC, so whatever is
 * stored here is served from the Supabase origin to anyone with the URL — an
 * uploaded `text/html` would be a stored-XSS page on our own domain. Hence an
 * allowlist rather than a denylist, and the extension is derived from the
 * approved type rather than taken from the (client-controlled) filename.
 *
 * SVG is deliberately absent: it is scriptable, and nothing in the app needs
 * user-supplied vector artwork.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * A year. Safe because every upload takes a fresh timestamped path and nothing
 * overwrites one — a replaced image is a new URL, so a stored object is
 * immutable in practice. next/image runs `unoptimized` here, so these bytes are
 * served straight to browsers; the 1h Supabase default was pure revalidation.
 */
const CACHE_CONTROL = "31536000";

/** Upload an image to the public media bucket. Returns the storage path. */
export async function uploadImage(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Image too large (8MB max)");
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new Error("Images only — JPEG, PNG, WebP, GIF or AVIF.");
  const db = serviceDb();
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, file, { contentType: file.type, cacheControl: CACHE_CONTROL });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * Drop a replaced object so the bucket doesn't accumulate orphans — there is no
 * media library to sweep them up yet (GAPS A1.4). Best-effort by design: the
 * row already points at the new file, so a failure here is litter, not a
 * broken page, and must never fail the save.
 */
export async function removeMedia(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { error } = await serviceDb().storage.from("media").remove([path]);
  if (error) console.warn(`[media] could not remove ${path}: ${error.message}`);
}

/**
 * Documents (the advertising media pack). Deliberately a separate function
 * rather than a wider allowlist on uploadImage: that helper's guarantee is that
 * whatever it stores is an image, and every caller relies on it. A PDF is safe
 * to serve from the public bucket, an HTML file would not be — so the allowlist
 * stays closed and explicit here too.
 */
const ALLOWED_DOC_TYPES: Record<string, string> = { "application/pdf": "pdf" };
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

export async function uploadDocument(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_DOC_BYTES) throw new Error("File too large (20MB max)");
  const ext = ALLOWED_DOC_TYPES[file.type];
  if (!ext) throw new Error("PDF only.");
  const db = serviceDb();
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}
