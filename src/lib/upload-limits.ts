/**
 * Upload limits shared by the server (lib/media.ts, which enforces them) and
 * the browser (the rich-text editor, which checks them first so an oversized
 * photo fails instantly instead of after a slow round trip). Client-safe on
 * purpose: media.ts pulls in sharp and the service client, so the editor can't
 * import from there — and keeping one copy here means the two can't drift.
 *
 * The bucket is PUBLIC, so this is an allowlist, not a denylist; the extension
 * is derived from the approved type, never the client-controlled filename. SVG
 * is deliberately absent: it is scriptable.
 */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const IMAGE_TOO_LARGE = "Image too large (8MB max)";
export const IMAGE_WRONG_TYPE = "Images only — JPEG, PNG, WebP, GIF or AVIF.";

/**
 * What an editor upload action hands back. Errors are returned, not thrown:
 * Next replaces a thrown server-action error's message with a generic one in
 * production, so a throw would tell the editor nothing it could show.
 */
export type UploadResult = { url: string } | { error: string };

/** The same checks media.ts makes, minus the bytes — null when the file is fine. */
export function imageUploadProblem(file: { size: number; type: string }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return IMAGE_TOO_LARGE;
  if (!ALLOWED_IMAGE_TYPES[file.type]) return IMAGE_WRONG_TYPE;
  return null;
}
