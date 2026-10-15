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
/** The bytes aren't the image the file claims to be — renamed, damaged, or not an image at all. */
export const IMAGE_UNREADABLE = "That file isn't a readable JPEG, PNG, WebP, GIF or AVIF image — it may be damaged, or a different kind of file renamed. Try exporting it again.";

/**
 * A refusal meant for the person uploading — too large, wrong type, not
 * really an image. Only these messages are shown to them as-is; anything else
 * an upload throws (a storage or database error) is logged and replaced with a
 * generic line, because its text is the provider's, not ours
 * (lib/editor-upload uploadFailureMessage).
 */
export class UploadRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

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

/**
 * Documents (the advertising media pack, member resources): PDF only, for the
 * same public-bucket reason as the image list. Here rather than in media.ts
 * so the direct-upload path can refuse a 30MB PDF before sending a byte of it.
 */
export const ALLOWED_DOC_TYPES: Record<string, string> = { "application/pdf": "pdf" };
export const MAX_DOC_BYTES = 20 * 1024 * 1024;

export const DOC_TOO_LARGE = "File too large (20MB max)";
export const DOC_WRONG_TYPE = "PDF only.";
export const DOC_UNREADABLE = "That file isn't a PDF — it may be damaged, or a different kind of file renamed. Try exporting it as PDF again.";

/** uploadDocument's checks, minus the bytes — null when the file is fine. */
export function documentUploadProblem(file: { size: number; type: string }): string | null {
  if (file.size > MAX_DOC_BYTES) return DOC_TOO_LARGE;
  if (!ALLOWED_DOC_TYPES[file.type]) return DOC_WRONG_TYPE;
  return null;
}

/**
 * What a file field accepts. "image-or-pdf" is the resources form, which
 * stores either and decides which by the file's type.
 */
export type UploadKind = "image" | "pdf" | "image-or-pdf";
export const UPLOAD_KINDS: readonly UploadKind[] = ["image", "pdf", "image-or-pdf"];

/** The pre-check for a field of `kind` — null when the file is fine. */
export function uploadProblem(kind: UploadKind, file: { size: number; type: string }): string | null {
  if (kind === "image") return imageUploadProblem(file);
  if (kind === "pdf") return documentUploadProblem(file);
  return ALLOWED_DOC_TYPES[file.type] ? documentUploadProblem(file) : imageUploadProblem(file);
}

/** Shown for any upload failure that isn't the file's fault — the real error goes to the log. */
export const UPLOAD_FAILED = "The upload didn't go through — please try again in a moment.";
/**
 * A staged upload (lib/staged-upload) the server can no longer find: swept
 * after sitting unclaimed, already used by an earlier save, or not this
 * person's to claim. The same words for all three — which one it was is
 * nothing the uploader can act on, and saying "not yours" would confirm it exists.
 */
export const UPLOAD_EXPIRED = "That upload has expired — please choose the file again.";
export const UPLOAD_RATE_LIMITED = "That's a lot of uploads in a short time — wait a few minutes, then try again.";
export const UPLOAD_SIGNED_OUT = "You've been signed out — sign in again, then choose the file again.";

/**
 * What the direct-upload request (app/uploads/actions requestUploadSlot)
 * hands back: where to send the bytes and the staged path the form then
 * carries — or the reason it won't, as a value, for the same reason as
 * UploadResult.
 */
export type UploadSlot = { path: string; url: string } | { error: string };
