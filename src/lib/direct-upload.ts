import { requestUploadSlot } from "@/app/uploads/actions";
import { uploadProblem, UploadRejectedError, type UploadKind } from "@/lib/upload-limits";

/**
 * The browser half of a direct upload (lib/staged-upload has the whole flow):
 * ask the server for a slot, send the file's bytes straight to Storage, and
 * hand back the staged path for the form to post instead of the file.
 *
 * The bytes go up with XMLHttpRequest rather than supabase-js's
 * uploadToSignedUrl because fetch reports no upload progress, and a 20MB PDF
 * on a phone connection needs more than a spinner. The request is the one
 * uploadToSignedUrl sends (@supabase/storage-js 2.112): a PUT of multipart
 * form data — cacheControl, metadata, then the file under an empty field
 * name — with x-upsert false, so a slot can be filled once and never
 * overwritten.
 *
 * Every rejection is an Error whose message is ours and safe to show as it
 * stands; nothing from Storage reaches the person.
 */

/** The staged object's cache lifetime. Nothing ever serves it, so the shortest sensible figure. */
const STAGED_CACHE_CONTROL = "60";

const noun = (kind: UploadKind) => (kind === "image" ? "image" : "file");

/** The request never completed — offline, dropped, or blocked on the way. */
export const uploadConnectionFailed = (kind: UploadKind) => `The ${noun(kind)} didn't upload — check your connection and try again.`;
/** Storage answered, and not with success. Its words are for the log, not the person. */
export const uploadRefused = (kind: UploadKind) => `The ${noun(kind)} didn't upload — please try again in a moment.`;

/** A failure stageUpload words itself — its message is shown as it stands. */
export class DirectUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectUploadError";
  }
}

/**
 * What to tell the person about a failed stageUpload: our own refusal or
 * transport wording passes through; anything else (a bug, never a provider's
 * text — none reaches here) becomes the connection line.
 */
export function uploadErrorMessage(e: unknown, kind: UploadKind): string {
  return e instanceof UploadRejectedError || e instanceof DirectUploadError ? e.message : uploadConnectionFailed(kind);
}

type Options = {
  /** Fraction sent, 0–1, as the browser reports it. */
  onProgress?: (fraction: number) => void;
  /** Abort when the person picks another file or leaves; rejects with an AbortError. */
  signal?: AbortSignal;
};

function put(url: string, file: File, kind: UploadKind, { onProgress, signal }: Options): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Upload cancelled", "AbortError"));
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    // Browser-safe by design (it grants only the anon role); sent because
    // supabase-js always sends it, so the API gateway sees the request it expects.
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        console.warn(`[direct-upload] storage answered ${xhr.status}: ${String(xhr.responseText).slice(0, 200)}`);
        reject(new DirectUploadError(uploadRefused(kind)));
      }
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DirectUploadError(uploadConnectionFailed(kind)));
    };
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });

    const body = new FormData();
    body.append("cacheControl", STAGED_CACHE_CONTROL);
    // The media library shows the original filename (lib/staged-upload reads it back).
    body.append("metadata", JSON.stringify({ name: file.name }));
    body.append("", file);
    xhr.send(body);
  });
}

/**
 * Send `file` for a field of `kind` straight to Storage; resolves with its
 * staged path. The same pre-check the server makes runs first, so an
 * oversized photo is refused before a byte of it is sent.
 */
export async function stageUpload(file: File, kind: UploadKind, options: Options = {}): Promise<string> {
  const problem = uploadProblem(kind, file);
  if (problem) throw new UploadRejectedError(problem);
  let slot: Awaited<ReturnType<typeof requestUploadSlot>>;
  try {
    slot = await requestUploadSlot({ kind, size: file.size, type: file.type });
  } catch {
    // The action itself never throws for a refusal — this is the request
    // failing (offline, or a deploy that retired the action's id).
    throw new DirectUploadError(uploadConnectionFailed(kind));
  }
  if ("error" in slot) throw new UploadRejectedError(slot.error);
  await put(slot.url, file, kind, options);
  return slot.path;
}

/** True for the rejection stageUpload gives when its signal aborts — the caller moved on, so there is nothing to report. */
export function isUploadAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}
