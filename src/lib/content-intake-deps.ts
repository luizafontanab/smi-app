import { geocodeAddress } from "@/lib/adapters/geocode";
import type { IntakeDeps, IntakeUploads } from "@/lib/content-intake";
import type { LifecycleDeps } from "@/lib/content-lifecycle";
import { serviceDb } from "@/lib/db/server";
import { uploadFailureMessage } from "@/lib/editor-upload";
import { enqueue } from "@/lib/jobs";
import { logError } from "@/lib/log";
import { removeMedia, removeMediaIfUnused, uploadImage } from "@/lib/media";
import { CONSOLE_UPLOADS, memberUploads, submittedFile, type UploadOwner } from "@/lib/staged-upload";

/**
 * The real adapters submission intake runs on (lib/content-intake). Lives
 * apart from the "use server" action files, which may only export async
 * functions, and apart from the intake module itself, so that stays free of
 * storage and network imports and unit-tests with fakes.
 */

/** Files are claimed from `owner`'s staging prefix only: a member's own, or the console's. */
function uploads(owner: UploadOwner): IntakeUploads {
  return {
    async store(form, field, folder, failure) {
      try {
        return { path: await uploadImage(await submittedFile(form, field, owner), folder) };
      } catch (e) {
        return { error: uploadFailureMessage(e, failure.area, failure.fallback) };
      }
    },
    remove: (path) => removeMedia(path),
    removeIfUnused: (paths) => removeMediaIfUnused(paths),
  };
}

/**
 * Tell the console a member has put something in front of Jas. Loaded on use,
 * as the dashboard always has. Never throws — notifyConsole swallows its own
 * failures, since the submission is already saved by the time this runs. The
 * one copy: the dashboard's other submissions (equipment, adverts, page edits)
 * call it too.
 */
export async function notifyConsoleOnUse(n: Parameters<typeof import("@/lib/notify-admin").notifyConsole>[0]): Promise<void> {
  const { notifyConsole } = await import("@/lib/notify-admin");
  await notifyConsole(n);
}

function deps(owner: UploadOwner): IntakeDeps {
  return {
    db: serviceDb(),
    upload: uploads(owner),
    geocode: geocodeAddress,
    notify: notifyConsoleOnUse,
    log: (area, error, context) => logError({ source: "server", area, error, context }),
    enqueue,
  };
}

export const memberIntakeDeps = (memberId: string): IntakeDeps => deps(memberUploads(memberId));
export const consoleIntakeDeps = (): IntakeDeps => deps(CONSOLE_UPLOADS);

/** The content lifecycle's dependencies, for the member's withdraw. */
export const memberLifecycleDeps = (): LifecycleDeps => ({ db: serviceDb(), enqueue });
