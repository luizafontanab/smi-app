import { must } from "../db/must";
import { serviceDb } from "../db/server";
import type { Json } from "../db/types";
import { logError } from "../log";
import { CHECK_EVERY_MS, runSourceWatch } from "./check";

/**
 * A source check, from the schedule (the `source_watch` job) or from an
 * admin's "Check sources now" (issue #42). Only one runs at a time, so two
 * clicks, or a click during a scheduled run, never read the same sites twice.
 *
 * The record is one `settings` row, as the Bigin sync's is. It is the lock
 * while a check runs and the summary the console shows once it has finished.
 * `settings` has RLS on and no policies, so only the service role sees it,
 * admin names included.
 */

export const SOURCE_CHECK_KEY = "source_check_last";
/** A check that started this long ago and never finished was cut off (e.g. by the server's time limit), so it no longer blocks the next one. */
export const ABANDON_AFTER_MS = 3 * 60 * 1000;

export type SourceCheckRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  /** The admin who clicked "Check sources now"; null when the schedule started it. */
  started_by: string | null;
  /** Set when an admin's click ignored the once-a-day rule: `due` is then every active source. */
  forced?: boolean;
  /** Sources due when the check started (every active source, when forced). */
  due?: number;
  checked?: number;
  new_items?: number;
  /** Checked, but nothing could be read from them this time. */
  unreadable?: number;
  /** Hit an error on our side (logged); still due. */
  failed?: number;
  /** Still being read at the hard stop, so cancelled; nothing written, still due. */
  cut_off?: number;
  /** Sources still due once the check finished (when forced: not reached this time). */
  still_due?: number;
  /**
   * When nothing was due: when the next source comes due. Null means there
   * are no active sources at all; left out if that couldn't be worked out.
   */
  next_due_at?: string | null;
  /** Set when the check stopped with an error. What it reached before that is kept. */
  error?: string;
};

export type SourceCheckOutcome =
  /** `run.finished_at` is null if a source was still winding down at the hard stop: the lock stays held until ABANDON_AFTER_MS. */
  | { status: "done"; run: SourceCheckRun }
  /** Another check holds the lock. `retryAt` is when it is sure to be free. */
  | { status: "busy"; run: SourceCheckRun | null; retryAt: Date };

/**
 * The name of an error runSourceCheck throws when it failed before taking the
 * lock: nothing was fetched and nothing was recorded. Checked by name, as
 * jobs.ts does for EmailSendError, so a mocked module needn't export a class.
 */
export const NOT_STARTED = "SourceCheckNotStarted";

function notStarted(e: unknown): Error {
  const err = new Error(e instanceof Error ? e.message : String(e), { cause: e });
  err.name = NOT_STARTED;
  return err;
}

type Db = ReturnType<typeof serviceDb>;
type WatchOptions = Omit<NonNullable<Parameters<typeof runSourceWatch>[0]>, "now">;

/** An idle record for the lock to claim on the very first check. */
const IDLE: SourceCheckRun = { id: "idle", started_at: new Date(0).toISOString(), finished_at: new Date(0).toISOString(), started_by: null };

/**
 * Take the lock: overwrite the record with this run, but only if the last
 * check has finished or was abandoned. Postgres re-checks the condition on a
 * row another update just changed, so of two runs claiming at once only one
 * gets the row back.
 */
async function claim(db: Db, run: SourceCheckRun, now: Date): Promise<boolean> {
  const { error: seedError } = await db.from("settings")
    .upsert({ key: SOURCE_CHECK_KEY, value: IDLE as unknown as Json }, { onConflict: "key", ignoreDuplicates: true });
  if (seedError) throw new Error(`source check: preparing the record: ${seedError.message}`);
  const { data, error } = await db.from("settings")
    .update({ value: run as unknown as Json })
    .eq("key", SOURCE_CHECK_KEY)
    .or(claimableFilter(now))
    .select("key");
  if (error) throw new Error(`source check: taking the lock: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** PostgREST `or` filter for a record that can be claimed: the last check finished, or started over ABANDON_AFTER_MS ago. */
export function claimableFilter(now: Date): string {
  const abandonedBefore = new Date(now.getTime() - ABANDON_AFTER_MS).toISOString();
  return `value->>finished_at.not.is.null,value->>started_at.lt."${abandonedBefore}"`;
}

/** Write the finished run, unless a newer check has taken over the record since (this one ran past ABANDON_AFTER_MS). */
async function finish(db: Db, run: SourceCheckRun) {
  const { error } = await db.from("settings")
    .update({ value: run as unknown as Json })
    .eq("key", SOURCE_CHECK_KEY)
    .eq("value->>id", run.id);
  if (error) throw new Error(`source check: saving the result: ${error.message}`);
}

/** When the least recently checked active source comes due again. */
async function nextDueAt(db: Db): Promise<string | null> {
  const { data, error } = await db.from("content_sources")
    .select("last_checked_at")
    .eq("active", true)
    .not("last_checked_at", "is", null)
    .order("last_checked_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`source check: finding the next due source: ${error.message}`);
  const last = data?.[0]?.last_checked_at;
  return last ? new Date(Date.parse(last) + CHECK_EVERY_MS).toISOString() : null;
}

/**
 * Run one source check under the lock. "busy" means another check holds it,
 * and nothing was fetched. The caller checks the Story crawler flag first.
 *
 * Throws an error named NOT_STARTED if it failed before taking the lock. Any
 * other error came after: the record keeps whatever the check reached.
 */
export async function runSourceCheck({ startedBy, now = () => new Date(), ...watch }: { startedBy: string | null; now?: () => Date } & WatchOptions): Promise<SourceCheckOutcome> {
  const db = serviceDb();
  const run: SourceCheckRun = {
    id: crypto.randomUUID(), started_at: now().toISOString(), finished_at: null, started_by: startedBy,
    ...(watch.force ? { forced: true } : {}),
  };
  let claimed: boolean;
  try {
    claimed = await claim(db, run, now());
  } catch (e) {
    throw notStarted(e);
  }
  if (!claimed) {
    // Only for the message; "busy" is already certain, so a failed read doesn't change it.
    const holder = await readSourceCheckRun().catch(() => null);
    const freeFrom = (holder && !holder.finished_at ? Date.parse(holder.started_at) : now().getTime()) + ABANDON_AFTER_MS;
    return { status: "busy", run: holder, retryAt: new Date(Math.max(freeFrom, now().getTime() + 60_000)) };
  }

  let reached: Partial<SourceCheckRun> = {};
  try {
    const result = await runSourceWatch({ ...watch, now });
    reached = {
      due: result.due,
      checked: result.checked,
      new_items: result.newItems,
      unreadable: result.unreadable,
      failed: result.failed,
      cut_off: result.cutOff,
      // Every source checked is marked so, and every worker has stopped (or
      // the lock stays held, below), so this is what the table now holds.
      still_due: Math.max(0, result.due - result.checked),
    };
    // A worker that didn't wind down may still be reading or writing. Leave
    // the record unfinished so the lock holds until ABANDON_AFTER_MS, and no
    // other check reads the same sites meanwhile.
    const finishedAt = result.settled ? now().toISOString() : null;
    const done: SourceCheckRun = {
      ...run,
      ...reached,
      finished_at: finishedAt,
      next_due_at: result.due === 0 ? await nextDueAtIfKnown(db) : null,
    };
    await finish(db, done);
    return { status: "done", run: done };
  } catch (e) {
    // Release the lock rather than leaving it to time out, keeping what the
    // check reached. If even this write fails, ABANDON_AFTER_MS frees it.
    await finish(db, { ...run, ...reached, finished_at: now().toISOString(), error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    throw e;
  }
}

/** nextDueAt, but only a nicety: failing to work it out mustn't fail a finished check. Undefined (left out of the record) if it failed. */
async function nextDueAtIfKnown(db: Db): Promise<string | null | undefined> {
  try {
    return await nextDueAt(db);
  } catch (e) {
    logError({ source: "job", area: "job:source_watch", error: e });
    return undefined;
  }
}

/** The last check's record, or null before the first. Throws if the read fails, like the page's other reads. */
export async function readSourceCheckRun(): Promise<SourceCheckRun | null> {
  const data = await must(serviceDb().from("settings").select("value").eq("key", SOURCE_CHECK_KEY).maybeSingle(), "source check record");
  const run = data?.value as SourceCheckRun | undefined;
  return run && run.id !== "idle" ? run : null;
}

/** A check that hasn't finished and isn't old enough to count as abandoned. */
export function isRunning(run: SourceCheckRun | null, nowMs: number): boolean {
  return !!run && !run.finished_at && nowMs - Date.parse(run.started_at) < ABANDON_AFTER_MS;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line the console shows about the last source check. */
export function sourceCheckSummary(run: SourceCheckRun | null, nowMs: number): string {
  if (!run) return "No source check has run yet.";
  const who = run.started_by ? `by ${run.started_by}` : "by schedule";
  if (!run.finished_at) {
    return isRunning(run, nowMs)
      ? `A check is running — started ${when(run.started_at)} ${who}.`
      : `The last check, started ${when(run.started_at)} ${who}, didn't finish. What it reached is saved.`;
  }
  const head = `Last check ${when(run.started_at)} ${who}`;
  // No counts means it stopped before reading a single source.
  if (run.error && run.due === undefined) return `${head} stopped with an error before checking any sources.`;
  const tail = run.error ? " Then it stopped with an error." : "";
  if (!run.due) {
    // Nothing due and no active source last checked: there are no active sources.
    if (run.forced || run.next_due_at === null) return `${head}: there are no active sources to check.${tail}`;
    const next = run.next_due_at ? ` The next are due from ${when(run.next_due_at)}.` : "";
    return `${head}: nothing was due — every source was checked in the last ${CHECK_EVERY_MS / 3_600_000} hours.${next}${tail}`;
  }
  const parts = [plural(run.new_items ?? 0, "new suggestion")];
  if (run.unreadable) parts.push(`${run.unreadable} couldn't be read`);
  if (run.failed) parts.push(`${run.failed} hit an error`);
  if (run.forced) {
    return `${head}: checked ${run.checked ?? 0} of ${plural(run.due, "active source")} — ${parts.join(", ")}. ${run.still_due ?? 0} not reached this time.${tail}`;
  }
  return `${head}: checked ${run.checked ?? 0} of ${plural(run.due, "due source")} — ${parts.join(", ")}. ${run.still_due ?? 0} still due.${tail}`;
}
