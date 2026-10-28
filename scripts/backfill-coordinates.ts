/**
 * Fill in map coordinates for every member with an address but no pin, via
 * Nominatim (scripts/lib/coordinate-backfill.ts). One request a second, so
 * ~400 members take 7–14 minutes. Never overwrites coordinates already set.
 *
 *   pnpm coordinates:backfill -- --dry-run             # local, write nothing
 *   pnpm coordinates:backfill                          # local
 *   pnpm coordinates:backfill:prod -- --dry-run
 *   pnpm coordinates:backfill:prod
 *
 * --dry-run    look everything up and print it, write nothing
 * --limit N    only the first N members (by slug) — for a quick look
 * --remote     write to a hosted project. Refused without it, whatever the
 *              shell's env points at; coordinates:backfill:prod passes it.
 *
 * Safe to re-run: it only ever picks up members still without coordinates,
 * so an interrupted run simply carries on where it stopped.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCoordinateBackfill } from "./lib/coordinate-backfill";
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
assertScriptTarget(SUPABASE_URL, "the coordinate backfill");
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : undefined;
if (LIMIT !== undefined && !(LIMIT > 0)) throw new Error("--limit needs a positive number");

async function main() {
  console.log(`— target: ${SUPABASE_URL}${DRY_RUN ? " (dry run)" : ""}`);
  const r = await runCoordinateBackfill(db, { dryRun: DRY_RUN, limit: LIMIT, log: (l) => console.log(l) });
  console.log(`\n${r.candidates} members with an address but no coordinates: ${r.byAddress} found by address, ${r.byPostcode} by postcode, ${r.unresolved.length} not found.`);
  console.log(`${r.noAddress} more have no coordinates and no address — nothing to look up until an address is added.`);
  if (r.unresolved.length) {
    console.log("\nNot found (fix the address in the console, or type the coordinates in):");
    for (const u of r.unresolved) console.log(`${u.slug}\t${u.address}`);
  }
  console.log(DRY_RUN ? "Dry run complete — nothing was written." : "Coordinate backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
