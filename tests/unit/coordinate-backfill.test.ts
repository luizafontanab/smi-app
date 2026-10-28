import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runCoordinateBackfill } from "../../scripts/lib/coordinate-backfill";

type Row = { id: string; slug: string; address: string | null };

/** Just enough of the supabase-js builder for the backfill: one paged select, conditional updates. */
function fakeDb(rows: Row[]) {
  const updates: { id: string; values: unknown; filter: string }[] = [];
  const selectFilters: string[] = [];
  const db = {
    from: () => ({
      select: () => {
        const q = {
          or: (f: string) => (selectFilters.push(f), q),
          not: () => q,
          order: () => q,
          range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
        };
        return q;
      },
      update: (values: unknown) => ({
        eq: (_col: string, id: string) => ({
          or: async (filter: string) => (updates.push({ id, values, filter }), { error: null }),
        }),
      }),
    }),
  };
  return { db: db as unknown as SupabaseClient, updates, selectFilters };
}

const rows: Row[] = [
  { id: "1", slug: "found-by-address", address: "1 High St, Telford TF1 6AH" },
  { id: "2", slug: "found-by-postcode", address: "ACME Ltd,, Unit 8, Nowhere Park, CV3 4RS" },
  { id: "3", slug: "not-found", address: "Somewhere vague" },
  { id: "4", slug: "blank", address: "   " },
  { id: "5", slug: "no-address", address: null },
];

const geocode = vi.fn(async (a: string) => (a.startsWith("1 High St") ? { lat: 52.7, lng: -2.5 } : null));
const geocodePostcode = vi.fn(async (p: string) => (p === "CV3 4RS" ? { lat: 52.4, lng: -1.4 } : null));

describe("runCoordinateBackfill", () => {
  it("tries the address, then the postcode, and reports what it couldn't place", async () => {
    const { db, updates, selectFilters } = fakeDb(rows);
    const r = await runCoordinateBackfill(db, { dryRun: false, geocode, geocodePostcode, sleep: async () => {} });

    expect(selectFilters).toEqual(["lat.is.null,lng.is.null"]);
    expect(r).toEqual({
      candidates: 3,
      byAddress: 1,
      byPostcode: 1,
      unresolved: [{ slug: "not-found", address: "Somewhere vague" }],
      noAddress: 2, // a blank and a null address — never sent
    });
    expect(updates).toEqual([
      { id: "1", values: { lat: 52.7, lng: -2.5 }, filter: "lat.is.null,lng.is.null" },
      { id: "2", values: { lat: 52.4, lng: -1.4 }, filter: "lat.is.null,lng.is.null" },
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const { db, updates } = fakeDb(rows);
    const r = await runCoordinateBackfill(db, { dryRun: true, geocode, geocodePostcode, sleep: async () => {} });
    expect(updates).toEqual([]);
    expect(r.byAddress + r.byPostcode).toBe(2);
  });

  it("waits between requests, never before the first (Nominatim: one a second)", async () => {
    const { db } = fakeDb(rows);
    const sleep = vi.fn(async () => {});
    await runCoordinateBackfill(db, { dryRun: true, geocode, geocodePostcode, sleep, delayMs: 1100 });
    // 3 address lookups + 1 postcode lookup ("Somewhere vague" has no postcode) = 4 requests, 3 waits.
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(1100);
  });

  it("honours --limit", async () => {
    const { db, updates } = fakeDb(rows);
    const r = await runCoordinateBackfill(db, { dryRun: false, limit: 1, geocode, geocodePostcode, sleep: async () => {} });
    expect(r.candidates).toBe(1);
    expect(updates.map((u) => u.id)).toEqual(["1"]);
  });
});
