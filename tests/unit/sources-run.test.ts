import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ABANDON_AFTER_MS, NOT_STARTED, SOURCE_CHECK_KEY, claimableFilter, isRunning, readSourceCheckRun, runSourceCheck, sourceCheckSummary, type SourceCheckRun } from "@/lib/sources/run";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { runSourceWatch } = vi.hoisted(() => ({ runSourceWatch: vi.fn() }));
vi.mock("@/lib/sources/check", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/sources/check")>()), runSourceWatch }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

const NOW = new Date("2026-11-05T10:42:00Z");
const now = () => NOW;

afterEach(() => {
  resetDbServerMocks();
  runSourceWatch.mockReset();
  logError.mockReset();
});

const watched = (over: Record<string, unknown> = {}) => ({ due: 1, checked: 1, newItems: 0, unreadable: 0, failed: 0, cutOff: 0, settled: true, ...over });

/** Each `.from(table)` call gets the next result in order, and every builder is kept so a test can read what was written. */
function tables(results: Record<string, DbResult[]>) {
  const made: Record<string, ReturnType<typeof queryBuilder>[]> = {};
  const from = vi.fn((table: string) => {
    const list = results[table];
    if (!list) throw new Error(`unexpected table ${table}`);
    made[table] ??= [];
    const b = queryBuilder(list[Math.min(made[table].length, list.length - 1)]);
    made[table].push(b);
    return b;
  });
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return made;
}
const calls = (b: ReturnType<typeof queryBuilder>, method: string) =>
  vi.mocked(b[method] as (...a: unknown[]) => unknown).mock.calls;

describe("runSourceCheck", () => {
  it("does nothing when another check holds the lock, says who has it, and when it's sure to be free", async () => {
    const holder: SourceCheckRun = { id: "r1", started_at: "2026-11-05T10:41:30Z", finished_at: null, started_by: "Jas" };
    // seed upsert, claim update (no row back = not ours), read the record
    tables({ settings: [dbOk(null), dbOk([]), dbOk({ value: holder })] });

    const outcome = await runSourceCheck({ startedBy: "Luiza", now });

    expect(outcome).toEqual({ status: "busy", run: holder, retryAt: new Date(Date.parse(holder.started_at) + ABANDON_AFTER_MS) });
    expect(runSourceWatch).not.toHaveBeenCalled();
  });

  it("claims only a finished or abandoned record, so two checks never run at once", async () => {
    runSourceWatch.mockResolvedValue(watched());
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)] });

    await runSourceCheck({ startedBy: "Jas", now });

    const [seed, claim] = t.settings;
    // the first ever check needs a row to claim; an existing one is left alone
    expect(calls(seed, "upsert")[0][1]).toEqual({ onConflict: "key", ignoreDuplicates: true });
    const abandonedBefore = new Date(NOW.getTime() - ABANDON_AFTER_MS).toISOString();
    expect(calls(claim, "or")[0][0]).toBe(`value->>finished_at.not.is.null,value->>started_at.lt."${abandonedBefore}"`);
    expect(calls(claim, "update")[0][0]).toEqual({ value: expect.objectContaining({ started_by: "Jas", finished_at: null, started_at: NOW.toISOString() }) });
  });

  it("records what the check did, against the record it claimed, with no extra counting queries", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 410, checked: 182, newItems: 7, unreadable: 3, failed: 1, cutOff: 4 }));
    // content_sources isn't listed: any query on it would throw
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)] });

    const outcome = await runSourceCheck({ startedBy: "Jas", now });

    expect(outcome.status).toBe("done");
    expect(outcome.run).toEqual(expect.objectContaining({
      started_by: "Jas", finished_at: NOW.toISOString(),
      due: 410, checked: 182, new_items: 7, unreadable: 3, failed: 1, cut_off: 4, still_due: 228, next_due_at: null,
    }));
    const save = t.settings[2];
    expect(calls(save, "update")[0][0]).toEqual({ value: outcome.run });
    // a run that overran and was taken over must not overwrite the newer one
    expect(calls(save, "eq")).toContainEqual(["value->>id", outcome.run!.id]);
    expect(runSourceWatch).toHaveBeenCalledWith({ now });
  });

  it("keeps the lock when a source didn't wind down at the hard stop, so no other check reads it meanwhile", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 50, checked: 40, settled: false }));
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)] });

    const outcome = await runSourceCheck({ startedBy: "Jas", now });

    expect(outcome.status).toBe("done");
    expect(outcome.run).toEqual(expect.objectContaining({ finished_at: null, checked: 40, still_due: 10 }));
    expect(calls(t.settings[2], "update")[0][0]).toEqual({ value: expect.objectContaining({ finished_at: null }) });
    // still "running" to the claim filter and the page until ABANDON_AFTER_MS
    expect(isRunning(outcome.run!, NOW.getTime())).toBe(true);
  });

  it("works out when the next source comes due when nothing was", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 0, checked: 0 }));
    tables({
      settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)],
      content_sources: [dbOk([{ last_checked_at: "2026-11-05T03:05:00Z" }])],
    });

    const outcome = await runSourceCheck({ startedBy: null, now });

    expect(outcome.run).toEqual(expect.objectContaining({ due: 0, checked: 0, still_due: 0, next_due_at: "2026-11-05T23:05:00.000Z" }));
  });

  it("still records a finished check if the next-due lookup fails", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 0, checked: 0 }));
    tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)], content_sources: [dbError("timeout")] });

    const outcome = await runSourceCheck({ startedBy: null, now });

    expect(outcome.run).toEqual(expect.objectContaining({ finished_at: NOW.toISOString(), due: 0 }));
    // left out, not null: null would claim there are no active sources
    expect(outcome.run!.next_due_at).toBeUndefined();
    expect(outcome.run!.error).toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("passes force through to the watcher and marks the record as forced", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 724, checked: 150 }));
    tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)] });

    const outcome = await runSourceCheck({ startedBy: "Jas", force: true, now });

    expect(runSourceWatch).toHaveBeenCalledWith({ force: true, now });
    expect(outcome.run).toEqual(expect.objectContaining({ forced: true, due: 724, checked: 150, still_due: 574 }));
  });

  it("records null for the next due time when there are no active sources", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 0, checked: 0 }));
    tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)], content_sources: [dbOk([])] });

    const outcome = await runSourceCheck({ startedBy: null, now });

    expect(outcome.run!.next_due_at).toBeNull();
    expect(outcome.run!.forced).toBeUndefined();
  });

  it("releases the lock when the check throws, keeping the error, and still throws", async () => {
    runSourceWatch.mockRejectedValue(new Error("source_watch: reading sources: timeout"));
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)] });

    await expect(runSourceCheck({ startedBy: "Jas", now })).rejects.toThrow("timeout");

    expect(calls(t.settings[2], "update")[0][0]).toEqual({
      value: expect.objectContaining({ finished_at: NOW.toISOString(), error: "source_watch: reading sources: timeout" }),
    });
  });

  it("keeps what the check reached when it fails after the sources were read", async () => {
    runSourceWatch.mockResolvedValue(watched({ due: 80, checked: 80, newItems: 30 }));
    // the result write fails; the error write after it goes through
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbError("connection reset"), dbOk(null)] });

    await expect(runSourceCheck({ startedBy: "Jas", now })).rejects.toThrow("saving the result: connection reset");

    expect(calls(t.settings[3], "update")[0][0]).toEqual({
      value: expect.objectContaining({ checked: 80, new_items: 30, still_due: 0, error: "source check: saving the result: connection reset" }),
    });
  });

  it("fails loudly when the lock can't be taken, rather than running unguarded, and says nothing started", async () => {
    tables({ settings: [dbOk(null), dbError("permission denied")] });
    const error = await runSourceCheck({ startedBy: "Jas", now }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("taking the lock: permission denied");
    expect((error as Error).name).toBe(NOT_STARTED);
    expect(runSourceWatch).not.toHaveBeenCalled();
  });
});

describe("readSourceCheckRun", () => {
  it("throws when the record can't be read, rather than passing it off as no check ever run", async () => {
    tables({ settings: [dbError("permission denied")] });
    await expect(readSourceCheckRun()).rejects.toThrow("permission denied");
  });

  it("is null before the first check", async () => {
    tables({ settings: [dbOk({ value: { id: "idle", started_at: "x", finished_at: "x", started_by: null } })] });
    expect(await readSourceCheckRun()).toBeNull();
  });
});

describe("sourceCheckSummary", () => {
  const nowMs = NOW.getTime();
  const base = { id: "r", started_at: "2026-11-05T10:30:00Z", started_by: "Jas" };

  it("says so before any check has run", () => {
    expect(sourceCheckSummary(null, nowMs)).toBe("No source check has run yet.");
  });

  it("gives the counts, in UK time, and who started it", () => {
    expect(sourceCheckSummary({ ...base, finished_at: "2026-11-05T10:30:50Z", due: 410, checked: 182, new_items: 7, unreadable: 3, failed: 0, still_due: 228 }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: checked 182 of 410 due sources — 7 new suggestions, 3 couldn't be read. 228 still due.");
    expect(sourceCheckSummary({ ...base, started_by: null, finished_at: "x", due: 1, checked: 1, new_items: 1, unreadable: 0, failed: 2, still_due: 0 }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by schedule: checked 1 of 1 due source — 1 new suggestion, 2 hit an error. 0 still due.");
  });

  it("says when the next sources come due if nothing was", () => {
    expect(sourceCheckSummary({ ...base, finished_at: "x", due: 0, next_due_at: "2026-11-05T14:05:00Z" }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: nothing was due — every source was checked in the last 20 hours. The next are due from 5 Nov, 14:05.");
  });

  it("says there are no active sources rather than that every one was checked", () => {
    expect(sourceCheckSummary({ ...base, finished_at: "x", due: 0, next_due_at: null }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: there are no active sources to check.");
    expect(sourceCheckSummary({ ...base, finished_at: "x", forced: true, due: 0, checked: 0 }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: there are no active sources to check.");
    // the next-due lookup failed: no claim either way
    expect(sourceCheckSummary({ ...base, finished_at: "x", due: 0 }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: nothing was due — every source was checked in the last 20 hours.");
  });

  it("counts a forced check against every active source, and what it didn't reach", () => {
    expect(sourceCheckSummary({ ...base, finished_at: "x", forced: true, due: 724, checked: 150, new_items: 2, unreadable: 0, failed: 0, still_due: 574 }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: checked 150 of 724 active sources — 2 new suggestions. 574 not reached this time.");
  });

  it("tells a running check from one that was cut off", () => {
    const running = { ...base, started_at: "2026-11-05T10:41:30Z", finished_at: null };
    expect(isRunning(running, nowMs)).toBe(true);
    expect(sourceCheckSummary(running, nowMs)).toBe("A check is running — started 5 Nov, 10:41 by Jas.");
    const cutOff = { ...base, finished_at: null };
    expect(isRunning(cutOff, nowMs)).toBe(false);
    expect(sourceCheckSummary(cutOff, nowMs)).toBe("The last check, started 5 Nov, 10:30 by Jas, didn't finish. What it reached is saved.");
  });

  it("names a check that stopped with an error, with what it reached if anything", () => {
    expect(sourceCheckSummary({ ...base, finished_at: "x", error: "boom" }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas stopped with an error before checking any sources.");
    expect(sourceCheckSummary({ ...base, finished_at: "x", error: "boom", due: 80, checked: 80, new_items: 30, unreadable: 0, failed: 0, still_due: 0 }, nowMs))
      .toBe("Last check 5 Nov, 10:30 by Jas: checked 80 of 80 due sources — 30 new suggestions. 0 still due. Then it stopped with an error.");
  });
});

/*
 * The lock's whole guarantee is one PostgREST filter on a jsonb column, which
 * a stub can't vouch for. Against the local stack: the claim filter, run
 * through the same client calls runSourceCheck makes, lets exactly one of two
 * simultaneous claims through, and frees an abandoned record.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
describe.skipIf(!URL_ || !KEY)("the claim filter, against Postgres", () => {
  let db: ReturnType<typeof createClient<Database>>;
  // Its own key: the real record is left alone.
  const TEST_KEY = "source_check_lock_test";
  const record = (over: Partial<SourceCheckRun>) => ({ id: "x", started_at: NOW.toISOString(), finished_at: null, started_by: null, ...over });
  const claim = (id: string, at: Date) => db.from("settings")
    .update({ value: record({ id, started_at: at.toISOString() }) })
    .eq("key", TEST_KEY)
    .or(claimableFilter(at))
    .select("key");

  beforeAll(async () => {
    db = createClient<Database>(URL_!, KEY!, { auth: { persistSession: false } });
    await db.from("settings").delete().eq("key", TEST_KEY);
  });
  afterAll(async () => { await db.from("settings").delete().eq("key", TEST_KEY); });

  it("lets one of two simultaneous claims through, and frees a record left running too long", async () => {
    const seeded = await db.from("settings").insert({ key: TEST_KEY, value: record({ id: "idle", finished_at: NOW.toISOString() }) });
    expect(seeded.error).toBeNull();

    const [a, b] = await Promise.all([claim("a", NOW), claim("b", NOW)]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((a.data?.length ?? 0) + (b.data?.length ?? 0)).toBe(1);

    // the holder hasn't finished: a minute later it still blocks…
    const soon = await claim("c", new Date(NOW.getTime() + 60_000));
    expect(soon.data).toEqual([]);
    // …past ABANDON_AFTER_MS it no longer does
    const later = await claim("d", new Date(NOW.getTime() + ABANDON_AFTER_MS + 1000));
    expect(later.data).toHaveLength(1);

    // and the finish write only lands on the record it claimed
    const stale = await db.from("settings").update({ value: record({ id: "a", finished_at: NOW.toISOString() }) }).eq("key", TEST_KEY).eq("value->>id", "a").select("key");
    expect(stale.data).toEqual([]);
  });
});
