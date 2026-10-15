/**
 * Find — and optionally remove — the SAMPLE advert inventory that
 * `seed-real.ts` seedAdverts() put on a target, plus the sample rate-card rows
 * nothing references.
 *
 * Why this exists. Until 27 Sep 2026 a full `seed-real.ts` run seeded
 * placeholder adverts on `--remote` too, so the 24 Sep production import left
 * 8 banners and 5 supplier logos on the live site — each stamped SAMPLE, each
 * branded with a real member company that bought nothing, each booked `live`.
 * The seed now refuses to do that (HUMAN-TODO 17.10); this clears what it left.
 *
 *   pnpm remove-sample-adverts              # local (dry run)
 *   pnpm remove-sample-adverts:prod         # prod  (dry run)
 *   pnpm remove-sample-adverts:prod -- --delete
 *
 * A hosted target is refused without --remote, whatever the shell's env points
 * at; remove-sample-adverts:prod passes it. So a shell with production's env
 * still sourced cannot turn the "local" --delete into a delete on the live site.
 *
 * What counts as a sample: an advert whose artwork is under `panels/`, the
 * only place seedAdverts() writes. Nothing else writes there.
 *
 * What goes with it:
 *  - bookings, artwork proposals and newsletter slots — FK cascades;
 *  - analytics_events and rollups_daily rows for those adverts. Those carry
 *    advert_id with NO foreign key, so a plain delete would orphan them — and
 *    they would go on counting as advert impressions on real members' stats
 *    pages, for adverts those members never bought;
 *  - advert_products rows no booking references, since the same run created
 *    the rate card at invented prices. A referenced product is kept and named
 *    (advert_bookings.product_id is ON DELETE RESTRICT anyway).
 *
 * The SAMPLE SVGs under panels/ in storage are left alone: nothing points at
 * them once the rows are gone.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertScriptTarget } from "./lib/target-guard";

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.SUPABASE_SECRET_KEY) {
  const envFile = path.resolve(HERE, "../.env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY not set");
// Local unless --remote, which only remove-sample-adverts:prod passes — the same rule the
// seeds and the industry backfill follow (scripts/lib/target-guard.ts).
assertScriptTarget(SUPABASE_URL, "the sample-advert removal");
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const DELETE = process.argv.includes("--delete");

const countWhereIn = async (table: string, column: string, ids: string[]) => {
  if (!ids.length) return 0;
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
};

async function main() {
  console.log(`— target: ${SUPABASE_URL}${DELETE ? "  (--delete)" : "  (dry run)"}\n`);

  const { data: samples, error } = await db
    .from("adverts")
    .select("id, name, format, desktop_path")
    .like("desktop_path", "panels/%")
    .order("name");
  if (error) throw error;
  const ids = samples!.map((a) => a.id);

  console.log(`SAMPLE adverts (artwork under panels/): ${ids.length}`);
  for (const a of samples!) console.log(`  ${a.format.padEnd(14)} ${a.name}`);

  const [bookings, proposals, newsletterSlots, events, rollups] = await Promise.all([
    countWhereIn("advert_bookings", "advert_id", ids),
    countWhereIn("advert_artwork_proposals", "advert_id", ids),
    countWhereIn("newsletter_ads", "advert_id", ids),
    countWhereIn("analytics_events", "advert_id", ids),
    countWhereIn("rollups_daily", "advert_id", ids),
  ]);
  console.log(`\n  with them (cascade): ${bookings} bookings, ${proposals} artwork proposals, ${newsletterSlots} newsletter slots`);
  console.log(`  with them (no FK, deleted explicitly): ${events} analytics_events, ${rollups} rollups_daily`);

  // Products referenced by a booking that is NOT one of the samples' — those
  // stay. Samples' own bookings go first, so they don't hold a product back.
  const { data: products, error: pErr } = await db.from("advert_products").select("id, short_name, format, rate_pennies");
  if (pErr) throw pErr;
  const { data: refs, error: rErr } = await db.from("advert_bookings").select("product_id, advert_id").not("product_id", "is", null);
  if (rErr) throw rErr;
  const sampleIds = new Set(ids);
  const usedByReal = new Set(refs!.filter((r) => !sampleIds.has(r.advert_id)).map((r) => r.product_id));
  const unused = products!.filter((p) => !usedByReal.has(p.id));
  const kept = products!.filter((p) => usedByReal.has(p.id));
  const price = (p: { rate_pennies: number | null }) => (p.rate_pennies == null ? "unpriced" : `£${(p.rate_pennies / 100).toFixed(2)}`);
  console.log(`\nRate card (advert_products): ${products!.length} rows, ${unused.length} unused by any real booking`);
  for (const p of unused) console.log(`  delete  ${p.short_name.padEnd(28)} ${p.format.padEnd(18)} ${price(p)}`);
  for (const p of kept) console.log(`  keep    ${p.short_name.padEnd(28)} ${p.format.padEnd(18)} ${price(p)}  (a real booking uses it)`);

  if (!DELETE) {
    console.log("\nDry run — nothing deleted. Re-run with -- --delete to remove the above.");
    return;
  }

  // Order matters: the no-FK rows first (they need the ids), then the adverts
  // (cascading bookings), then products their bookings no longer hold.
  if (ids.length) {
    for (const table of ["analytics_events", "rollups_daily"]) {
      const { error: e } = await db.from(table).delete().in("advert_id", ids);
      if (e) throw new Error(`${table}: ${e.message}`);
    }
    const { error: aErr } = await db.from("adverts").delete().in("id", ids);
    if (aErr) throw new Error(`adverts: ${aErr.message}`);
  }
  if (unused.length) {
    const { error: uErr } = await db.from("advert_products").delete().in("id", unused.map((p) => p.id));
    if (uErr) throw new Error(`advert_products: ${uErr.message}`);
  }
  console.log(`\nDeleted ${ids.length} SAMPLE adverts (and ${bookings} bookings with them), ${events + rollups} analytics rows, ${unused.length} rate-card rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
