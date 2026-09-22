import { describe, expect, it } from "vitest";
import { must, mustList } from "@/lib/db/must";
import { dbError, dbOk, queryBuilder, type DbResult } from "../stubs/supabase";

/**
 * queryBuilder() models the real PostgrestFilterBuilder loosely — it is typed
 * for chainability, not for the client's row generics. must()/mustList() only
 * ever need the thenable, so narrow it to the success/failure union here
 * rather than dragging Database generics through the test.
 */
const q = <T>(result: DbResult<T>) =>
  queryBuilder(result) as unknown as PromiseLike<
    { data: T; error: null; count?: number | null } | { data: null; error: { message: string; code?: string }; count?: number | null }
  >;

describe("must", () => {
  it("returns data untouched on success", async () => {
    const row = { id: "m1", name: "Acme" };
    await expect(must(q(dbOk(row)), "console/members detail")).resolves.toBe(row);
  });

  it("returns a list untouched on success", async () => {
    const rows = [{ id: "m1" }, { id: "m2" }];
    await expect(must(q(dbOk(rows)), "console/members list")).resolves.toEqual(rows);
  });

  /**
   * The production failure this helper exists for: /console/members embeds
   * industry:industries(name), the industries table was missing from the prod
   * schema, and PostgREST rejected the whole request. The page discarded the
   * error and rendered "Members (0)" over 123 real rows.
   */
  it("throws on PGRST200, the missing-relationship error that read as an empty list", async () => {
    const broken = q(dbError("Could not find a relationship between 'members' and 'industries'", {
      code: "PGRST200",
      hint: "Verify that 'industries' exists",
      details: null,
    }));
    await expect(must(broken, "console/members list")).rejects.toThrow(/console\/members list/);
    await expect(must(broken, "console/members list")).rejects.toThrow(/PGRST200/);
    await expect(must(broken, "console/members list")).rejects.toThrow(/Could not find a relationship/);
  });

  it("names the label so the throwing screen is identifiable from the log", async () => {
    await expect(must(q(dbError("boom", { code: "42P01" })), "console/adverts list"))
      .rejects.toThrow("[console/adverts list] Supabase query failed: 42P01 boom");
  });

  it("appends hint and details when PostgREST supplies them", async () => {
    await expect(must(q(dbError("bad", { code: "42703", details: "column x", hint: "try y" })), "x"))
      .rejects.toThrow("[x] Supabase query failed: 42703 bad (column x — try y)");
  });

  /**
   * A .maybeSingle() miss is `{ data: null, error: null }` — a successful query
   * that found no row. It must pass straight through so `if (!row) notFound()`
   * still renders a 404 rather than the console error boundary.
   */
  it("passes a maybeSingle miss through as null without throwing", async () => {
    await expect(must(q(dbOk(null)), "console/members detail")).resolves.toBeNull();
  });

  /**
   * Deliberately NOT special-cased: .single() reports a missing row as PGRST116,
   * and this helper throws on it. Pages whose miss is a legitimate 404 use
   * .maybeSingle() (see the case above); .single() is reserved for rows whose
   * absence really is a broken invariant, and those should reach the boundary.
   */
  it("throws on PGRST116, so .single() keeps meaning 'this row must exist'", async () => {
    await expect(must(q(dbError("no rows returned", { code: "PGRST116" })), "console/x"))
      .rejects.toThrow(/PGRST116/);
  });

  it("throws an Error, so the console error boundary gets a digest", async () => {
    await expect(must(q(dbError("boom")), "x")).rejects.toBeInstanceOf(Error);
  });
});

describe("mustList", () => {
  it("returns both data and the exact count", async () => {
    const rows = [{ id: "m1" }];
    await expect(mustList(q(dbOk(rows, 123)), "console/members list")).resolves.toEqual({ data: rows, count: 123 });
  });

  it("reports count as null when the query did not ask for one", async () => {
    await expect(mustList(q(dbOk([{ id: "m1" }])), "console/members list"))
      .resolves.toEqual({ data: [{ id: "m1" }], count: null });
  });

  it("throws rather than reporting a failed query as an empty page", async () => {
    await expect(mustList(q(dbError("Could not find a relationship", { code: "PGRST200" })), "console/members list"))
      .rejects.toThrow(/PGRST200/);
  });

  it("preserves a genuine zero count", async () => {
    await expect(mustList(q(dbOk([], 0)), "console/members list")).resolves.toEqual({ data: [], count: 0 });
  });
});
