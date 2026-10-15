import { mediaUrl } from "@/lib/db/server";
import { logError } from "@/lib/log";
import { uploadImage } from "@/lib/media";
import { submittedFile, type UploadOwner } from "@/lib/staged-upload";
import {
  DOC_TOO_LARGE, DOC_UNREADABLE, DOC_WRONG_TYPE, IMAGE_TOO_LARGE, IMAGE_UNREADABLE, IMAGE_WRONG_TYPE, UPLOAD_EXPIRED, UPLOAD_FAILED,
  UploadRejectedError, type UploadResult,
} from "@/lib/upload-limits";

export { UPLOAD_FAILED };

/** Our own refusal wording — passed through even on a plain Error, so a caller that rethrows one loses nothing. */
const OWN_MESSAGES = new Set([IMAGE_TOO_LARGE, IMAGE_WRONG_TYPE, IMAGE_UNREADABLE, DOC_TOO_LARGE, DOC_WRONG_TYPE, DOC_UNREADABLE, UPLOAD_EXPIRED]);

/**
 * What to tell the uploader about a failed upload. The file's own problems —
 * too large, wrong type, not really an image (UploadRejectedError) — are ours
 * to word and pass through. Anything else is a storage or database error whose
 * text is the provider's, sometimes naming buckets, paths or constraints: it
 * is logged, and the person sees `fallback`.
 */
export function uploadFailureMessage(e: unknown, area: string, fallback = UPLOAD_FAILED): string {
  if (e instanceof UploadRejectedError || (e instanceof Error && OWN_MESSAGES.has(e.message))) return e.message;
  logError({ source: "server", area, error: e });
  return fallback;
}

/**
 * The body of every rich-text editor's image-upload action: store the file,
 * hand back its public URL — or the reason it was refused, as a value. The
 * actions call their auth guard *before* this, outside any try, so an auth
 * redirect still propagates as a redirect rather than being caught here.
 *
 * "file" is the image itself or, from the editor, the path it was staged at
 * (lib/staged-upload) — claimable only by `owner`, which the action derives
 * from the session, never from the request.
 */
export async function editorImageUpload(formData: FormData, owner: UploadOwner, prefix: string): Promise<UploadResult> {
  try {
    const url = mediaUrl(await uploadImage(await submittedFile(formData, "file", owner), prefix));
    return url ? { url } : { error: "No image was received — try choosing it again." };
  } catch (e) {
    return { error: uploadFailureMessage(e, "upload:editor-image") };
  }
}
