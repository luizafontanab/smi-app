import sharp from "sharp";
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
 * Stored images are served byte-for-byte (next/image runs `unoptimized`; see
 * CACHE_CONTROL below), so the only place bytes can be bounded is here at
 * upload. 2560px covers the widest slot in the app (the 1280px takeover at 2×)
 * with headroom; an editor's straight-off-the-camera 6000px JPEG was otherwise
 * the LCP on every phone that loaded it.
 */
const MAX_DIMENSION = 2560;

/**
 * Cap dimensions and bake in EXIF orientation, keeping the original format.
 * Best-effort by the same rule as everything else in this file: a sharp
 * failure falls back to the original bytes rather than failing the upload.
 * GIFs pass through untouched — sharp would flatten the animation.
 */
async function normalizeImage(file: File, ext: string): Promise<{ body: File | Buffer; byteSize: number }> {
  if (ext === "gif") return { body: file, byteSize: file.size };
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const img = sharp(input, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const within =
      (meta.width ?? 0) <= MAX_DIMENSION && (meta.height ?? 0) <= MAX_DIMENSION && (meta.orientation ?? 1) === 1;
    if (within) return { body: file, byteSize: file.size };
    const out = await img
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .toBuffer();
    return { body: out, byteSize: out.length };
  } catch (err) {
    console.warn(`[media] resize skipped: ${err instanceof Error ? err.message : err}`);
    return { body: file, byteSize: file.size };
  }
}

/**
 * A year. Safe because every upload takes a fresh timestamped path and nothing
 * overwrites one — a replaced image is a new URL, so a stored object is
 * immutable in practice. next/image runs `unoptimized` here, so these bytes are
 * served straight to browsers; the 1h Supabase default was pure revalidation.
 */
const CACHE_CONTROL = "31536000";

/**
 * Best-effort media-library row for an object already written to storage. A
 * failure here must never break the actual upload/save it's recording — the
 * library is a convenience index (A1.4), not the source of truth.
 */
async function recordMedia(db: ReturnType<typeof serviceDb>, path: string, kind: "image" | "document", file: File, byteSize = file.size) {
  const { error } = await db.from("media").insert({
    path,
    kind,
    content_type: file.type,
    byte_size: byteSize,
    original_name: file.name || null,
  });
  if (error) console.warn(`[media] could not record ${path}: ${error.message}`);
}

/** Upload an image to the public media bucket. Returns the storage path. */
export async function uploadImage(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Image too large (8MB max)");
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new Error("Images only — JPEG, PNG, WebP, GIF or AVIF.");
  const db = serviceDb();
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { body, byteSize } = await normalizeImage(file, ext);
  const { error } = await db.storage.from("media").upload(path, body, { contentType: file.type, cacheControl: CACHE_CONTROL });
  if (error) throw new Error(error.message);
  await recordMedia(db, path, "image", file, byteSize);
  return path;
}

/**
 * Drop a replaced object so the bucket doesn't accumulate orphans. Best-effort
 * by design: the row already points at the new file, so a failure here is
 * litter, not a broken page, and must never fail the save. Also drops the
 * media-library row so the library stays in sync with the bucket.
 */
export async function removeMedia(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const db = serviceDb();
  const { error } = await db.storage.from("media").remove([path]);
  if (error) console.warn(`[media] could not remove ${path}: ${error.message}`);
  await db.from("media").delete().eq("path", path);
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
  await recordMedia(db, path, "document", file);
  return path;
}
