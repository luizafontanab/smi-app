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

/** Upload an image to the public media bucket. Returns the storage path. */
export async function uploadImage(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Image too large (8MB max)");
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) throw new Error("Images only — JPEG, PNG, WebP, GIF or AVIF.");
  const db = serviceDb();
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}
