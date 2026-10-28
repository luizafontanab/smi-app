import type { SupabaseClient } from "@supabase/supabase-js";
import { geocodeAddress, geocodePostcode, ukPostcode, type Coordinates } from "../../src/lib/adapters/geocode";

/**
 * Map pins for members that have an address but no coordinates.
 *
 * Profile saves geocode a changed address (lib/member-geocode), but members
 * that arrived by import or seed were never saved, so most had no pin — the
 * profile map and the directory's Map view were empty for them.
 *
 * Per member: the full address first, then its UK postcode alone. Nominatim's
 * usage policy allows at most one request a second, so every request after
 * the first waits `delayMs`.
 *
 * Only ever fills blanks: a member with coordinates is never selected, and
 * each write is conditional on a coordinate still being missing, so a pin typed in the
 * console while this runs is not overwritten.
 */
export type BackfillDeps = {
  geocode?: (address: string) => Promise<Coordinates | null>;
  geocodePostcode?: (postcode: string) => Promise<Coordinates | null>;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  delayMs?: number;
};

export type BackfillResult = {
  candidates: number;
  byAddress: number;
  byPostcode: number;
  unresolved: { slug: string; address: string }[];
  /** Members without coordinates that have no address either — nothing to look up. */
  noAddress: number;
};

type Row = { id: string; slug: string; address: string | null };

export async function runCoordinateBackfill(db: SupabaseClient, opts: { dryRun: boolean; limit?: number } & BackfillDeps): Promise<BackfillResult> {
  const geocode = opts.geocode ?? geocodeAddress;
  const byPostcodeLookup = opts.geocodePostcode ?? geocodePostcode;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const delayMs = opts.delayMs ?? 1100;

  // Paged: PostgREST caps a single select at 1000 rows.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("members")
      .select("id, slug, address")
      .or("lat.is.null,lng.is.null")
      .order("slug")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  const withAddress = rows.filter((r) => r.address?.trim());
  const todo = withAddress.slice(0, opts.limit ?? Infinity);

  const result: BackfillResult = { candidates: todo.length, byAddress: 0, byPostcode: 0, unresolved: [], noAddress: rows.length - withAddress.length };
  let requests = 0;
  const lookup = async <T>(fn: (arg: T) => Promise<Coordinates | null>, arg: T) => {
    if (requests++ > 0) await sleep(delayMs);
    return fn(arg);
  };

  for (const [i, m] of todo.entries()) {
    const address = m.address!.trim();
    let coords = await lookup(geocode, address);
    let how: "address" | "postcode" | null = coords ? "address" : null;
    if (!coords) {
      const postcode = ukPostcode(address);
      if (postcode) {
        coords = await lookup(byPostcodeLookup, postcode);
        if (coords) how = "postcode";
      }
    }

    if (!coords || !how) {
      result.unresolved.push({ slug: m.slug, address });
      log(`[${i + 1}/${todo.length}] ${m.slug}: no match`);
      continue;
    }
    if (how === "address") result.byAddress++;
    else result.byPostcode++;
    log(`[${i + 1}/${todo.length}] ${m.slug}: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} (by ${how})`);

    if (!opts.dryRun) {
      const { error } = await db.from("members").update({ lat: coords.lat, lng: coords.lng }).eq("id", m.id).or("lat.is.null,lng.is.null");
      if (error) throw error;
    }
  }
  return result;
}
