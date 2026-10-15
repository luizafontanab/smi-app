import sharp from "sharp";
import { serviceDb } from "@/lib/db/server";
import {
  ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES, DOC_TOO_LARGE, DOC_UNREADABLE, DOC_WRONG_TYPE, IMAGE_TOO_LARGE, IMAGE_UNREADABLE, IMAGE_WRONG_TYPE,
  MAX_DOC_BYTES, MAX_UPLOAD_BYTES, UploadRejectedError,
} from "@/lib/upload-limits";

/**
 * What may land in the `media` bucket. The bucket is PUBLIC, so whatever is
 * stored here is served from the Supabase origin to anyone with the URL — an
 * uploaded `text/html` would be a stored-XSS page on our own domain. Hence an
 * allowlist rather than a denylist, and both the stored type and the
 * extension come from the file's own bytes (verifiedImageType), never from its
 * client-controlled name or declared type. The list itself lives in
 * lib/upload-limits so the editor can pre-check it.
 */
const ALLOWED_TYPES = ALLOWED_IMAGE_TYPES;

export { MAX_UPLOAD_BYTES };

/**
 * Stored images are served byte-for-byte (next/image runs `unoptimized`; see
 * CACHE_CONTROL below), so the only place bytes can be bounded is here at
 * upload. 2560px covers the widest slot in the app (the 1280px takeover at 2×)
 * with headroom; an editor's straight-off-the-camera 6000px JPEG was otherwise
 * the LCP on every phone that loaded it.
 */
const MAX_DIMENSION = 2560;

/**
 * What the first bytes say a file is — only ever one of the allowlisted image
 * types, null for anything else. The browser's `file.type` comes from the
 * file's name, and a POST can say anything at all, so it decides nothing about
 * what is stored: these signatures do. AVIF is an ISO-BMFF `ftyp` box naming
 * an avif/avis brand; HEIC shares the box but not the brand, and isn't allowed.
 */
export function sniffImageType(head: Uint8Array): string | null {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, text: string) => at(offset, [...text].map((c) => c.charCodeAt(0)));
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp")) {
    const boxEnd = Math.min(head.length, ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0);
    // major brand at 8, then compatible brands from 16 to the end of the box
    for (let offset = 8; offset + 4 <= boxEnd; offset += offset === 8 ? 8 : 4) {
      if (ascii(offset, "avif") || ascii(offset, "avis")) return "image/avif";
    }
  }
  return null;
}

/** sharp's name for each allowlisted type. It reports AVIF as its HEIF container. */
const SHARP_FORMATS: Record<string, readonly string[]> = {
  "image/jpeg": ["jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/avif": ["heif", "avif"],
};

/**
 * The file's real type, or an UploadRejectedError. Two checks, both on the
 * bytes: the signature must be an allowlisted image, and sharp must be able to
 * read it as that same format — a valid header on a body of anything else
 * (an HTML page behind "GIF89a", say) fails the second. GIFs are checked too,
 * though normalizeImage then leaves them untouched.
 *
 * A file whose bytes are a different allowed image than it claims — a PNG
 * saved as .jpg, which browsers then call image/jpeg — is accepted and stored
 * as what it really is: refusing it would turn away ordinary photos, and
 * serving it under the right Content-Type is the safe outcome either way.
 */
async function verifiedImageType(input: Buffer): Promise<string> {
  const type = sniffImageType(input.subarray(0, 64));
  if (!type) throw new UploadRejectedError(IMAGE_UNREADABLE);
  try {
    const meta = await sharp(input).metadata();
    if (!SHARP_FORMATS[type].includes(String(meta.format))) throw new Error(`sharp read ${meta.format}`);
  } catch (err) {
    console.warn(`[media] refused an unreadable ${type}: ${err instanceof Error ? err.message : err}`);
    throw new UploadRejectedError(IMAGE_UNREADABLE);
  }
  return type;
}

/**
 * Cap dimensions and bake in EXIF orientation, keeping the original format.
 * Runs only on bytes verifiedImageType has already accepted, so a sharp
 * failure here is a resize problem, not a type one: it falls back to the
 * original bytes rather than failing the upload, by the same best-effort rule
 * as everything else in this file. GIFs pass through untouched — sharp would
 * flatten the animation.
 */
async function normalizeImage(input: Buffer, ext: string): Promise<{ body: Buffer; byteSize: number }> {
  if (ext === "gif") return { body: input, byteSize: input.length };
  try {
    const img = sharp(input, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    const within =
      (meta.width ?? 0) <= MAX_DIMENSION && (meta.height ?? 0) <= MAX_DIMENSION && (meta.orientation ?? 1) === 1;
    if (within) return { body: input, byteSize: input.length };
    const out = await img
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .toBuffer();
    return { body: out, byteSize: out.length };
  } catch (err) {
    console.warn(`[media] resize skipped: ${err instanceof Error ? err.message : err}`);
    return { body: input, byteSize: input.length };
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
async function recordMedia(db: ReturnType<typeof serviceDb>, path: string, kind: "image" | "document", file: File, byteSize = file.size, contentType = file.type) {
  const { error } = await db.from("media").insert({
    path,
    kind,
    content_type: contentType,
    byte_size: byteSize,
    original_name: file.name || null,
  });
  if (error) console.warn(`[media] could not record ${path}: ${error.message}`);
}

/**
 * Upload an image to the public media bucket. Returns the storage path.
 * Refusals the uploader should see are UploadRejectedErrors; a storage failure
 * is a plain Error carrying the provider's text, for the log rather than them.
 */
export async function uploadImage(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadRejectedError(IMAGE_TOO_LARGE);
  // The declared type is a cheap first refusal (and what the editor pre-checks);
  // the stored type and extension come from the bytes below.
  if (!ALLOWED_TYPES[file.type]) throw new UploadRejectedError(IMAGE_WRONG_TYPE);
  const input = Buffer.from(await file.arrayBuffer());
  const type = await verifiedImageType(input);
  const ext = ALLOWED_TYPES[type];
  const db = serviceDb();
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { body, byteSize } = await normalizeImage(input, ext);
  const { error } = await db.storage.from("media").upload(path, body, { contentType: type, cacheControl: CACHE_CONTROL });
  if (error) throw new Error(error.message);
  await recordMedia(db, path, "image", file, byteSize, type);
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
 * removeMedia for each of `paths` that nothing references any more — for a
 * row that took its images with it (a deleted story draft). The database is
 * asked first (media_paths_in_use, migration 20261016000021) because an image
 * can be in use far from where it was uploaded: the media library lets the
 * desk reuse any of them. If that check fails, nothing is removed: litter is
 * recoverable, a broken image on someone else's page is not.
 */
export async function removeMediaIfUnused(paths: readonly (string | null | undefined)[]): Promise<void> {
  const candidates = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (!candidates.length) return;
  const { data: inUse, error } = await serviceDb().rpc("media_paths_in_use", { p_paths: candidates });
  if (error || !Array.isArray(inUse)) {
    console.warn(`[media] kept ${candidates.length} file(s): could not check what uses them${error ? ` (${error.message})` : ""}`);
    return;
  }
  const keep = new Set<string>(inUse);
  await Promise.all(candidates.filter((p) => !keep.has(p)).map((p) => removeMedia(p)));
}

/**
 * Documents (the advertising media pack). Deliberately a separate function
 * rather than a wider allowlist on uploadImage: that helper's guarantee is that
 * whatever it stores is an image, and every caller relies on it. A PDF is safe
 * to serve from the public bucket, an HTML file would not be — so the allowlist
 * stays closed and explicit here too. The allowlist, cap and wording live in
 * lib/upload-limits so the browser can pre-check them.
 */
export { MAX_DOC_BYTES };

/** Every PDF opens with this header (ISO 32000-1 §7.5.2); anything else isn't one, whatever it is called. */
const PDF_MAGIC = "%PDF-";

export async function uploadDocument(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > MAX_DOC_BYTES) throw new UploadRejectedError(DOC_TOO_LARGE);
  const ext = ALLOWED_DOC_TYPES[file.type];
  if (!ext) throw new UploadRejectedError(DOC_WRONG_TYPE);
  // Stored as application/pdf from a public bucket, so the bytes have to be
  // one: the declared type is only the file's name talking.
  const head = Buffer.from(await file.slice(0, PDF_MAGIC.length).arrayBuffer()).toString("latin1");
  if (head !== PDF_MAGIC) throw new UploadRejectedError(DOC_UNREADABLE);
  const db = serviceDb();
  const path = `${prefix}/${Date.now().toString(36)}.${ext}`;
  const { error } = await db.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  await recordMedia(db, path, "document", file);
  return path;
}
