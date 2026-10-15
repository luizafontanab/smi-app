import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { lastPage, pagedList } from "@/app/console/paged-list";
import { dbError, dbOk, queryBuilder, type DbResult } from "../stubs/supabase";

// The console lists (stories, members, CRM) page with .range(); a page past the
// end used to throw into the console error boundary.

const PAST_END = () => dbError("Requested range not satisfiable", { code: "PGRST103" });

/** queryBuilder() is typed loosely (a record of mocks); pagedList wants the awaitable it really is. */
const q = (result: DbResult) => queryBuilder(result) as unknown as PromiseLike<DbResult>;
type Build = (from: number, to: number) => PromiseLike<DbResult>;

describe("pagedList", () => {
  it("returns the page asked for when it exists", async () => {
    const build = vi.fn<Build>(() => q(dbOk([{ id: "a" }], 120)));
    expect(await pagedList(build, 2, 50, "t")).toEqual({ data: [{ id: "a" }], count: 120, page: 2 });
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(50, 99);
  });

  it("a page past the end comes back as the last page, not a throw", async () => {
    const results = [PAST_END(), dbOk([{ id: "x" }], 120), dbOk([{ id: "last" }], 120)];
    const build = vi.fn<Build>(() => q(results.shift()!));
    expect(await pagedList(build, 999, 50, "t")).toEqual({ data: [{ id: "last" }], count: 120, page: 3 });
    expect(build.mock.calls).toEqual([[49900, 49949], [0, 0], [100, 149]]);
  });

  it("an empty list past the end is page 1, empty", async () => {
    const results = [PAST_END(), dbOk([], 0), dbOk([], 0)];
    const build = vi.fn<Build>(() => q(results.shift()!));
    expect(await pagedList(build, 4, 50, "t")).toEqual({ data: [], count: 0, page: 1 });
  });

  it("any other error still throws, as mustList does", async () => {
    const build = () => q(dbError("relation does not exist", { code: "42P01" }));
    await expect(pagedList(build, 1, 50, "console/x")).rejects.toThrow(/\[console\/x\].*42P01/);
  });

  it("junk page numbers are page 1", async () => {
    const build = vi.fn<Build>(() => q(dbOk([], 0)));
    await pagedList(build, Number("abc"), 50, "t");
    await pagedList(build, -3, 50, "t");
    expect(build.mock.calls).toEqual([[0, 49], [0, 49]]);
  });

  it("lastPage is never below 1", () => {
    expect(lastPage(0, 50)).toBe(1);
    expect(lastPage(50, 50)).toBe(1);
    expect(lastPage(51, 50)).toBe(2);
  });
});

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const KEY = process.env.SUPABASE_SECRET_KEY;

// What the helper exists for, against the real PostgREST: a range beyond the
// last row is an error (PGRST103), not an empty page.
describe.skipIf(!KEY)("PostgREST past-the-end ranges (local stack)", () => {
  const db = createClient<Database>(URL_, KEY!, { auth: { persistSession: false } });
  const build = (from: number, to: number) =>
    db.from("stories").select("id", { count: "exact" }).order("id").range(from, to);

  it("a raw past-the-end range errors with PGRST103", async () => {
    const { error } = await build(1_000_000, 1_000_049);
    expect(error?.code).toBe("PGRST103");
  });

  it("pagedList turns it into the last page", async () => {
    // Asserted against the count it read itself — other suites add and remove
    // stories in parallel, so a count taken beforehand can drift.
    const result = await pagedList(build, 1_000_000, 50, "test");
    expect(result.page).toBe(lastPage(result.count, 50));
    expect(result.page).toBeLessThan(1_000_000);
  });
});
