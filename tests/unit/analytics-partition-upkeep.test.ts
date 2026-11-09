import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * analytics_events is partitioned by month and rejects rows for a month with
 * no partition. run_daily_rollup() is the only thing that creates them, so its
 * latest definition must cover this month as well as next: with next month
 * alone, a month the rollup missed is never created and every event in it is
 * dropped (staging, November 2026; 20261109000004).
 *
 * Static, like migration-function-hygiene: it reads the migration files, so it
 * needs no database.
 */
const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function latestRollupBody(): { file: string; body: string } {
  let latest: { file: string; body: string } | null = null;
  for (const file of files) {
    const text = readFileSync(path.join(DIR, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?run_daily_rollup\s*\([\s\S]*?\$\$([\s\S]*?)\$\$/gi)) {
      latest = { file, body: m[1] };
    }
  }
  if (!latest) throw new Error("run_daily_rollup() not found in any migration");
  return latest;
}

describe("analytics partition upkeep", () => {
  const { file, body } = latestRollupBody();
  const calls = [...body.matchAll(/ensure_analytics_partition\s*\(([^;]*)\)\s*;/gi)].map((m) => m[1].replace(/\s+/g, " ").trim());

  it("finds the latest run_daily_rollup definition", () => {
    expect(file >= "20261109000004").toBe(true);
  });

  it("ensures this month's partition", () => {
    expect(calls).toContain("now()::date");
  });

  it("ensures next month's partition", () => {
    expect(calls).toContain("(now() + interval '1 month')::date");
  });
});
