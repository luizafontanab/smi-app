/**
 * Assign industries to every member, story, video and event from Jas's mapping
 * of Services and news categories (scripts/lib/industry-map.ts). Run once on a
 * target right after migration 20261012000001, which swaps in his ten
 * industries and clears every old assignment.
 *
 *   pnpm industries:backfill -- --dry-run --report     # local, write nothing
 *   pnpm industries:backfill                            # local
 *   pnpm industries:backfill:prod -- --dry-run --report
 *   pnpm industries:backfill:prod
 *
 * --dry-run    print the counts, write nothing
 * --report     also print every member and story left without an industry, as
 *              tab-separated rows — the list Jas asked for ("I'll let you know
 *              later if any ends up without an industry")
 * --overwrite  run even though member_industries already has rows. The backfill
 *              recomputes everything from scratch, so this discards industries
 *              picked by hand since the last run.
 *
 * Reads member_services and story_categories from the target itself — no
 * WordPress export needed.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runIndustryBackfill } from "./lib/industry-backfill";

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
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes("--dry-run");
const REPORT = process.argv.includes("--report");
const OVERWRITE = process.argv.includes("--overwrite");

async function main() {
  console.log(`— target: ${SUPABASE_URL}`);
  const plan = await runIndustryBackfill(db, { dryRun: DRY_RUN, overwrite: OVERWRITE });

  if (REPORT) {
    const { unresolvedMembers, unresolvedStories } = plan.report;
    console.log(`\nMembers without an industry (${unresolvedMembers.length})`);
    console.log("slug\tname\tservices");
    for (const m of unresolvedMembers) console.log(`${m.slug}\t${m.name}\t${m.services.join(", ") || "(no services)"}`);
    console.log(`\nStories without an industry (${unresolvedStories.length})`);
    console.log("slug\ttitle\tcategories");
    for (const s of unresolvedStories) console.log(`${s.slug}\t${s.title}\t${s.categories.join(", ") || "(no categories)"}`);
  }

  console.log(DRY_RUN ? "Dry run complete — nothing was written." : "Industry backfill complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
