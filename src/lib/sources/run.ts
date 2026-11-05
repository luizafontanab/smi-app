import { serviceDb } from "../db/server";
import type { Json } from "../db/types";
import { CHECK_EVERY_MS, dueFilter, runSourceWatch } from "./check";

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
  /** Sources due when the check started. */
  due?: number;
  checked?: number;
  new_items?: number;
  /** Checked, but nothing could be read from them this time. */
  unreadable?: number;
  /** Hit an error on our side (logged); still due. */
  failed?: number;
  /** Sources still due once the check finished. */
  still_due?: number;
  /** When nothing was due: when the next source comes due. */
  next_due_at?: string | null;
  /** Set when the check stopped with an error. What it reached before that is kept. */
  error?: string;
};

export type SourceCheckOutcome =
  | { status: "done"; run: SourceCheckRun }
  | { status: "busy"; run: SourceCheckRun | null };

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

async function countDue(db: Db, now: Date): Promise<number> {
  const { count, error } = await db.from("content_sources")
    .select("*", { count: "exact", head: true })
    .eq("active", true)
    .or(dueFilter(now));
  if (error) throw new Error(`source check: counting due sources: ${error.message}`);
  return count ?? 0;
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
 */
export async function runSourceCheck({ startedBy, now = () => new Date(), ...watch }: { startedBy: string | null; now?: () => Date } & WatchOptions): Promise<SourceCheckOutcome> {
  const db = serviceDb();
  const run: SourceCheckRun = { id: crypto.randomUUID(), started_at: now().toISOString(), finished_at: null, started_by: startedBy };
  if (!(await claim(db, run, now()))) return { status: "busy", run: await readSourceCheckRun() };

  try {
    const due = await countDue(db, now());
    const result = due > 0 ? await runSourceWatch({ ...watch, now }) : { checked: 0, newItems: 0, unreadable: 0, failed: 0 };
    const done: SourceCheckRun = {
      ...run,
      finished_at: now().toISOString(),
      due,
      checked: result.checked,
      new_items: result.newItems,
      unreadable: result.unreadable,
      failed: result.failed,
      still_due: due > 0 ? await countDue(db, now()) : 0,
      next_due_at: due > 0 ? null : await nextDueAt(db),
    };
    await finish(db, done);
    return { status: "done", run: done };
  } catch (e) {
    // Release the lock rather than leaving it to time out. If even this write
    // fails, ABANDON_AFTER_MS frees it.
    await finish(db, { ...run, finished_at: now().toISOString(), error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    throw e;
  }
}

export async function readSourceCheckRun(): Promise<SourceCheckRun | null> {
  const { data } = await serviceDb().from("settings").select("value").eq("key", SOURCE_CHECK_KEY).maybeSingle();
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
  if (run.error) return `${head} stopped with an error. What it reached is saved.`;
  if (!run.due) {
    const next = run.next_due_at ? ` The next are due from ${when(run.next_due_at)}.` : "";
    return `${head}: nothing was due — every source was checked in the last 20 hours.${next}`;
  }
  const parts = [plural(run.new_items ?? 0, "new suggestion")];
  if (run.unreadable) parts.push(`${run.unreadable} couldn't be read`);
  if (run.failed) parts.push(`${run.failed} hit an error`);
  return `${head}: checked ${run.checked ?? 0} of ${plural(run.due, "due source")} — ${parts.join(", ")}. ${run.still_due ?? 0} still due.`;
}
