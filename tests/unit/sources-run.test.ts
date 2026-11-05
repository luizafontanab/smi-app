import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { ABANDON_AFTER_MS, SOURCE_CHECK_KEY, claimableFilter, isRunning, runSourceCheck, sourceCheckSummary, type SourceCheckRun } from "@/lib/sources/run";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { runSourceWatch } = vi.hoisted(() => ({ runSourceWatch: vi.fn() }));
vi.mock("@/lib/sources/check", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/sources/check")>()), runSourceWatch }));

const NOW = new Date("2026-11-05T10:42:00Z");
const now = () => NOW;

afterEach(() => {
  resetDbServerMocks();
  runSourceWatch.mockReset();
});

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
  it("does nothing when another check holds the lock, and says who has it", async () => {
    const holder: SourceCheckRun = { id: "r1", started_at: "2026-11-05T10:41:30Z", finished_at: null, started_by: "Jas" };
    // seed upsert, claim update (no row back = not ours), read the record
    tables({ settings: [dbOk(null), dbOk([]), dbOk({ value: holder })] });

    const outcome = await runSourceCheck({ startedBy: "Luiza", now });

    expect(outcome).toEqual({ status: "busy", run: holder });
    expect(runSourceWatch).not.toHaveBeenCalled();
  });

  it("claims only a finished or abandoned record, so two checks never run at once", async () => {
    runSourceWatch.mockResolvedValue({ due: 1, checked: 1, newItems: 0, unreadable: 0, failed: 0 });
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)], content_sources: [dbOk(null, 1), dbOk(null, 0)] });

    await runSourceCheck({ startedBy: "Jas", now });

    const [seed, claim] = t.settings;
    // the first ever check needs a row to claim; an existing one is left alone
    expect(calls(seed, "upsert")[0][1]).toEqual({ onConflict: "key", ignoreDuplicates: true });
    const abandonedBefore = new Date(NOW.getTime() - ABANDON_AFTER_MS).toISOString();
    expect(calls(claim, "or")[0][0]).toBe(`value->>finished_at.not.is.null,value->>started_at.lt."${abandonedBefore}"`);
    expect(calls(claim, "update")[0][0]).toEqual({ value: expect.objectContaining({ started_by: "Jas", finished_at: null, started_at: NOW.toISOString() }) });
  });

  it("records what the check did, against the record it claimed", async () => {
    runSourceWatch.mockResolvedValue({ due: 300, checked: 182, newItems: 7, unreadable: 3, failed: 1 });
    // due before the check, due after
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)], content_sources: [dbOk(null, 410), dbOk(null, 228)] });

    const outcome = await runSourceCheck({ startedBy: "Jas", now });

    expect(outcome.status).toBe("done");
    expect(outcome.run).toEqual(expect.objectContaining({
      started_by: "Jas", finished_at: NOW.toISOString(),
      due: 410, checked: 182, new_items: 7, unreadable: 3, failed: 1, still_due: 228, next_due_at: null,
    }));
    const save = t.settings[2];
    expect(calls(save, "update")[0][0]).toEqual({ value: outcome.run });
    // a run that overran and was taken over must not overwrite the newer one
    expect(calls(save, "eq")).toContainEqual(["value->>id", outcome.run!.id]);
    expect(runSourceWatch).toHaveBeenCalledWith({ now });
  });

  it("fetches nothing when nothing is due, and works out when the next source comes due", async () => {
    tables({
      settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)],
      content_sources: [dbOk(null, 0), dbOk([{ last_checked_at: "2026-11-05T03:05:00Z" }])],
    });

    const outcome = await runSourceCheck({ startedBy: null, now });

    expect(runSourceWatch).not.toHaveBeenCalled();
    expect(outcome.run).toEqual(expect.objectContaining({ due: 0, checked: 0, still_due: 0, next_due_at: "2026-11-05T23:05:00.000Z" }));
  });

  it("releases the lock when the check throws, keeping the error, and still throws", async () => {
    runSourceWatch.mockRejectedValue(new Error("source_watch: reading sources: timeout"));
    const t = tables({ settings: [dbOk(null), dbOk([{ key: SOURCE_CHECK_KEY }]), dbOk(null)], content_sources: [dbOk(null, 5)] });

    await expect(runSourceCheck({ startedBy: "Jas", now })).rejects.toThrow("timeout");

    expect(calls(t.settings[2], "update")[0][0]).toEqual({
      value: expect.objectContaining({ finished_at: NOW.toISOString(), error: "source_watch: reading sources: timeout" }),
    });
  });

  it("fails loudly when the lock can't be taken, rather than running unguarded", async () => {
    tables({ settings: [dbOk(null), dbError("permission denied")] });
    await expect(runSourceCheck({ startedBy: "Jas", now })).rejects.toThrow("taking the lock: permission denied");
    expect(runSourceWatch).not.toHaveBeenCalled();
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

  it("tells a running check from one that was cut off", () => {
    const running = { ...base, started_at: "2026-11-05T10:41:30Z", finished_at: null };
    expect(isRunning(running, nowMs)).toBe(true);
    expect(sourceCheckSummary(running, nowMs)).toBe("A check is running — started 5 Nov, 10:41 by Jas.");
    const cutOff = { ...base, finished_at: null };
    expect(isRunning(cutOff, nowMs)).toBe(false);
    expect(sourceCheckSummary(cutOff, nowMs)).toBe("The last check, started 5 Nov, 10:30 by Jas, didn't finish. What it reached is saved.");
  });

  it("names a check that stopped with an error", () => {
    expect(sourceCheckSummary({ ...base, finished_at: "x", error: "boom" }, nowMs)).toBe("Last check 5 Nov, 10:30 by Jas stopped with an error. What it reached is saved.");
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
