"use server";

import { currentUser } from "@/lib/auth";
import { HOUR, withinLimit } from "@/lib/rate-limit";
import { issueStagedUpload, uploadOwnerFor } from "@/lib/staged-upload";
import { UPLOAD_KINDS, UPLOAD_RATE_LIMITED, UPLOAD_SIGNED_OUT, type UploadKind, type UploadSlot } from "@/lib/upload-limits";

/**
 * Slots one uploader — a member, or the console as a whole, matching the
 * staging prefixes — may ask for in an hour. Every file chosen in any form is
 * one; a long story with a cover and thirty body images is ~31, and choosing
 * again after a refusal is another. 120 leaves that ordinary use nowhere near
 * it while capping what a stolen session can stage — at most 120 × 20MB an
 * hour per instance, all of it swept within a day. Per-instance memory, as
 * lib/rate-limit says of itself: a floor, not a guarantee.
 */
const SLOTS_PER_HOUR = 120;

/**
 * Step 1 of a direct upload (lib/staged-upload): where to send a file the
 * caller has chosen. Called from the browser by lib/direct-upload, never from
 * a form. Whose prefix the path goes under is the session's role, not
 * anything in the request; `kind`, `size` and `type` are the browser's
 * declaration, checked here and again on the bytes when the form is saved.
 *
 * Refusals come back as values rather than redirects: this runs mid-edit, and
 * a redirect would navigate the person away from an unsaved form.
 */
export async function requestUploadSlot(request: { kind: UploadKind; size: number; type: string }): Promise<UploadSlot> {
  const owner = uploadOwnerFor(await currentUser());
  if (!owner) return { error: UPLOAD_SIGNED_OUT };
  const kind = UPLOAD_KINDS.includes(request?.kind) ? request.kind : null;
  const size = Number(request?.size);
  const type = typeof request?.type === "string" ? request.type : "";
  // A malformed request is a client bug or a hand-made POST — either way there
  // is nothing more useful to say than the generic refusal of the right kind.
  if (!kind || !Number.isFinite(size) || size <= 0) return { error: "Choose a file to upload." };
  if (!withinLimit(`upload-slot:${owner}`, SLOTS_PER_HOUR, HOUR)) return { error: UPLOAD_RATE_LIMITED };
  return issueStagedUpload(owner, kind, { size, type });
}
