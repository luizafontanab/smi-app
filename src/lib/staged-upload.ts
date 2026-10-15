import { randomUUID } from "node:crypto";
import type { CurrentUser } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { logError } from "@/lib/log";
import {
  ALLOWED_DOC_TYPES, ALLOWED_IMAGE_TYPES, DOC_TOO_LARGE, IMAGE_TOO_LARGE, MAX_DOC_BYTES, UPLOAD_EXPIRED, UPLOAD_FAILED,
  uploadProblem, UploadRejectedError, type UploadKind, type UploadSlot,
} from "@/lib/upload-limits";

/**
 * Direct uploads: the browser sends a file's bytes straight to Supabase
 * Storage, and the form posts only the path it landed at.
 *
 * Why: every upload used to ride inside the server-action request, and Vercel
 * caps a Function's request body at 4.5MB whatever next.config's
 * bodySizeLimit says (https://vercel.com/docs/functions/limitations#request-body-size,
 * 413 FUNCTION_PAYLOAD_TOO_LARGE). An 8MB-allowed photo or a 20MB-allowed PDF
 * passed the browser's own check and then died at the platform as "check
 * your connection".
 *
 * The flow, and where trust sits:
 *   1. issueStagedUpload — for the signed-in caller, a signed upload URL for a
 *      fresh random path under *their* prefix of the private staging bucket.
 *      The path is the server's; the client only declares size and type,
 *      which are pre-checked here and enforced again by the bucket itself
 *      (file_size_limit / allowed_mime_types, migration 20261016000070).
 *   2. The browser PUTs the file there (lib/direct-upload).
 *   3. submittedFile, inside the form's own action — takes either the classic
 *      File (no JavaScript, small files) or a staged path. A path must sit
 *      under the caller's own prefix, derived from the session again, never
 *      from the request; its bytes are then handed to uploadImage /
 *      uploadDocument exactly as a classic File is, so the magic-byte and
 *      sharp checks, the resize, the final path and the media-library row
 *      are the same code either way.
 *   4. sweepStagedUploads — anything staged and never claimed is removed
 *      after STAGED_UPLOAD_MAX_AGE_HOURS (job upload_staging_sweep).
 *
 * The staging bucket is private and has no storage.objects policies at all,
 * so nothing but the service key and a signed URL's one path can write to
 * it, and nothing but the service key can read it: an unvalidated upload is
 * never served to anyone.
 */
export const STAGING_BUCKET = "upload-staging";

/**
 * How long an unclaimed staged file may sit before the sweep removes it. A
 * signed URL is valid for two hours (Supabase's fixed figure), so a file can
 * be staged up to two hours after it was asked for; a day on top of that
 * covers a story written slowly with its cover chosen first. Past it, the save
 * says UPLOAD_EXPIRED and the person chooses the file again.
 */
export const STAGED_UPLOAD_MAX_AGE_HOURS = 24;

/** Objects removed per storage call — the remove endpoint's own comfortable batch, as the seeds use. */
const SWEEP_BATCH = 100;
/** A ceiling on one sweep's work, so a remove that reports success without deleting can never spin the job forever. */
const SWEEP_MAX_BATCHES = 50;

/**
 * Whose staging prefix a path sits under: the console's (every admin shares
 * it, as they share the console's own upload prefixes) or one member's.
 */
export type UploadOwner = "console" | `members/${string}`;
export const CONSOLE_UPLOADS: UploadOwner = "console";
export const memberUploads = (memberId: string): UploadOwner => `members/${memberId}`;

/**
 * The owner for whoever is signed in. The two roles are exclusive
 * (lib/auth: requireMember turns an admin away and vice versa), so the role
 * alone decides — no area is taken from the request.
 */
export function uploadOwnerFor(user: CurrentUser | null): UploadOwner | null {
  if (user?.role === "admin") return CONSOLE_UPLOADS;
  if (user?.role === "member" && user.memberId) return memberUploads(user.memberId);
  return null;
}

/** Every extension a staged object can carry — the stored type is decided from the bytes later, this is only the name. */
const STAGED_EXTENSIONS = [...new Set([...Object.values(ALLOWED_IMAGE_TYPES), ...Object.values(ALLOWED_DOC_TYPES)])];
const STAGED_NAME = new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(?:${STAGED_EXTENSIONS.join("|")})$`);

/** True only for a path issueStagedUpload could have made for `owner`: their prefix, then one random name — no other folder, no `..`. */
export function isStagedPathFor(path: string, owner: UploadOwner): boolean {
  if (!path.startsWith(`${owner}/`)) return false;
  return STAGED_NAME.test(path.slice(owner.length + 1));
}

/**
 * Step 1: a signed upload URL for a fresh path under `owner`. Refusals are
 * returned as values with our own wording; a storage failure is logged and
 * becomes UPLOAD_FAILED, never the provider's text.
 */
export async function issueStagedUpload(owner: UploadOwner, kind: UploadKind, file: { size: number; type: string }): Promise<UploadSlot> {
  const problem = uploadProblem(kind, file);
  if (problem) return { error: problem };
  const ext = ALLOWED_IMAGE_TYPES[file.type] ?? ALLOWED_DOC_TYPES[file.type];
  const path = `${owner}/${randomUUID()}.${ext}`;
  const { data, error } = await serviceDb().storage.from(STAGING_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    logError({ source: "server", area: "upload:staging-slot", error: error ?? new Error("createSignedUploadUrl returned nothing") });
    return { error: UPLOAD_FAILED };
  }
  return { path, url: data.signedUrl };
}

/** A storage "no such object", whichever way this storage version words it. */
function isNotFound(error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown } | null;
  return e?.status === 404 || String(e?.statusCode) === "404" || /not.?found/i.test(String(e?.message ?? ""));
}

/** Drop a staged object. Best-effort: the sweep is the backstop for a failure here. */
async function discardStaged(path: string): Promise<void> {
  const { error } = await serviceDb().storage.from(STAGING_BUCKET).remove([path]);
  if (error) console.warn(`[staged-upload] could not remove ${path}: ${error.message}`);
}

/**
 * Step 3, for a path: the staged object as a File, ready for uploadImage or
 * uploadDocument — which do every check on its bytes, as they do on a posted
 * file. Removed from staging as soon as it has been read: from here on its
 * bytes are in hand, and the form that posted it has been reset, so nothing
 * will claim it twice.
 */
export async function takeStagedUpload(path: string, owner: UploadOwner): Promise<File> {
  if (!isStagedPathFor(path, owner)) throw new UploadRejectedError(UPLOAD_EXPIRED);
  const bucket = serviceDb().storage.from(STAGING_BUCKET);
  const { data: info, error: infoError } = await bucket.info(path);
  if (infoError || !info) {
    if (!infoError || isNotFound(infoError)) throw new UploadRejectedError(UPLOAD_EXPIRED);
    throw new Error(`staged upload ${path}: ${infoError.message}`);
  }
  const type = String(info.contentType ?? "");
  // The bucket refuses anything over MAX_DOC_BYTES already; checked again so a
  // hand-made bucket without that limit can't hand the function a huge file.
  // The per-kind caps are uploadImage's and uploadDocument's to apply.
  if (Number(info.size ?? 0) > MAX_DOC_BYTES) {
    await discardStaged(path);
    throw new UploadRejectedError(ALLOWED_DOC_TYPES[type] ? DOC_TOO_LARGE : IMAGE_TOO_LARGE);
  }
  const { data: blob, error } = await bucket.download(path);
  if (error || !blob) {
    if (!error || isNotFound(error)) throw new UploadRejectedError(UPLOAD_EXPIRED);
    throw new Error(`staged upload ${path}: ${error.message}`);
  }
  await discardStaged(path);
  // The original filename travels as the object's metadata (lib/direct-upload)
  // because the media library shows it; it is the client's say-so, exactly as
  // a posted File's name is, and is only ever displayed.
  const metaName = (info.metadata as { name?: unknown } | undefined)?.name;
  const name = typeof metaName === "string" && metaName.trim() ? metaName.trim().slice(0, 255) : path.slice(path.lastIndexOf("/") + 1);
  return new File([blob], name, { type: type || blob.type });
}

/**
 * What a file field carried: the File itself (the no-JavaScript form, as
 * before), or the File behind the staged path the direct-upload field put in
 * its place. Null when nothing was chosen. Throws what takeStagedUpload
 * throws, so callers keep their existing try/catch around the upload.
 */
export async function submittedFile(formData: FormData, field: string, owner: UploadOwner): Promise<File | null> {
  const values = formData.getAll(field);
  const staged = values.find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (staged) return takeStagedUpload(staged.trim(), owner);
  return values.find((v): v is File => typeof v !== "string") ?? null;
}

/** Whether a file field carried anything — a non-empty File or a staged path — without claiming it. */
export function hasSubmittedFile(formData: FormData, field: string): boolean {
  return formData.getAll(field).some((v) => (typeof v === "string" ? v.trim() !== "" : v.size > 0));
}

/**
 * Step 4: remove every staged object older than STAGED_UPLOAD_MAX_AGE_HOURS —
 * a form chosen-for and then abandoned. Returns how many went. The listing is
 * a database read (staged_uploads_older_than, migration 20261016000070) rather
 * than a walk of the bucket's folders, one per member; the removal goes
 * through the storage API, which is what deletes the bytes and not just the row.
 */
export async function sweepStagedUploads(now = Date.now()): Promise<number> {
  const db = serviceDb();
  const before = new Date(now - STAGED_UPLOAD_MAX_AGE_HOURS * 3_600_000).toISOString();
  let removed = 0;
  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const { data: names, error } = await db.rpc("staged_uploads_older_than", { p_before: before, p_limit: SWEEP_BATCH });
    if (error) throw new Error(`staged upload sweep (list) failed: ${error.message}`);
    if (!names?.length) break;
    const { data: gone, error: removeError } = await db.storage.from(STAGING_BUCKET).remove(names);
    if (removeError) throw new Error(`staged upload sweep (remove) failed: ${removeError.message}`);
    removed += gone?.length ?? 0;
    if (!gone?.length || names.length < SWEEP_BATCH) break;
  }
  return removed;
}
