/**
 * Import Jas's story-sources list (scripts/seed-assets/content-sources.csv,
 * ~726 company news pages) into content_sources. Run once per target after
 * migration 20261020000002; after that the list is edited on /console/sources.
 *
 *   pnpm sources:import          # local
 *   pnpm sources:import:prod     # production (passes --remote)
 *
 * Safe to re-run: addresses already on the list are left exactly as they are,
 * so nothing edited or paused in the console is undone. Fetches nothing — the
 * hourly source_watch job reads the sources afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importContentSources } from "./lib/content-sources";
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
// Local unless --remote, which only sources:import:prod passes (scripts/lib/target-guard.ts).
assertScriptTarget(SUPABASE_URL, "the story-sources import");
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

async function main() {
  console.log(`— target: ${SUPABASE_URL}`);
  const { added, skipped } = await importContentSources(db);
  console.log(`— story sources: ${added} added (addresses already on the list were left alone)`);
  for (const line of skipped) console.log(`  skipped, not an address: ${line}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
