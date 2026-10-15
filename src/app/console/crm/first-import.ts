import type { LastRun } from "@/lib/adapters/crm";

/**
 * The Bigin first import (~2,700 contacts, most subscribed) changes who the
 * next newsletter goes to, so it only runs after a person has previewed it —
 * and the preview has to be recent, or the numbers they agreed to aren't the
 * ones that will land. Shared by the console page (whether to offer "Run first
 * import") and runBiginSync (which enforces it: the action is POST-reachable,
 * so hiding the button was never the guard).
 *
 * An hour: long enough to read the counts and decide, short enough that a
 * preview from yesterday — before Bigin's list moved on — doesn't count.
 */
export const FIRST_IMPORT_PREVIEW_MAX_AGE_MS = 60 * 60_000;

export function firstImportPreviewFresh(lastRun: LastRun | null, now: Date = new Date()): boolean {
  if (!lastRun?.preview || !lastRun.pulled) return false;
  const at = Date.parse(lastRun.at);
  return Number.isFinite(at) && at <= now.getTime() && now.getTime() - at <= FIRST_IMPORT_PREVIEW_MAX_AGE_MS;
}
