import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSourceUrl } from "@/lib/sources/extract";
import { must } from "./must";

/**
 * The story-sources list (ChangeTower replacement): Jas's ~726 company news
 * pages, from `1 07 26.xlsx` via /SMI/content-sources/scraping-targets.csv.
 * Imported once — after that the list lives in the app and is edited on
 * /console/sources (requirements/06-content-os.md "Import it once").
 *
 * Safe to re-run: an address already on the list is left alone, so a source
 * edited or paused in the console keeps its changes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT_SOURCES_CSV = path.resolve(HERE, "../seed-assets/content-sources.csv");

/** `domain,url` rows; the url is quoted. Rows whose url isn't an address are skipped and returned. */
export function parseSourcesCsv(raw: string): { rows: { url: string; domain: string }[]; skipped: string[] } {
  const rows: { url: string; domain: string }[] = [];
  const skipped: string[] = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const url = line.slice(line.indexOf(",") + 1).trim().replace(/^"|"$/g, "");
    const parsed = normalizeSourceUrl(url);
    if (parsed) rows.push(parsed);
    else skipped.push(line);
  }
  return { rows, skipped };
}

export async function importContentSources(db: SupabaseClient, csvPath = CONTENT_SOURCES_CSV): Promise<{ added: number; skipped: string[] }> {
  const { rows, skipped } = parseSourcesCsv(await readFile(csvPath, "utf8"));
  // The list has a site twice under addresses that normalise to the same one
  // (#fragment dropped) — one row per address.
  const unique = [...new Map(rows.map((r) => [r.url, r])).values()];
  const { data } = await must("content_sources", db.from("content_sources")
    .upsert(unique, { onConflict: "url", ignoreDuplicates: true })
    .select("id"));
  return { added: data?.length ?? 0, skipped };
}
