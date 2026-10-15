import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two rules .claude/skills/db-change gives every Postgres function, checked
 * across every migration rather than remembered: EXECUTE revoked from PUBLIC
 * (Postgres grants it to PUBLIC on create), and a pinned search_path. Both
 * have been forgotten before — 20260816000002 exists for the first, and
 * story_summary (20261015000004) shipped without either until 20261016000032.
 *
 * Static on purpose: it reads the migration files, so it needs no database and
 * catches a new function before it is ever applied.
 */
const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sql = files.map((f) => ({ file: f, text: readFileSync(path.join(DIR, f), "utf8").replace(/--[^\n]*/g, "") }));

/** Functions created anywhere, with their latest definition's header (between the name and the body). */
const created = new Map<string, { file: string; header: string }>();
for (const { file, text } of sql) {
  for (const m of text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\$\$/gi)) {
    created.set(m[1].toLowerCase(), { file, header: m[2] });
  }
}
const all = sql.map((s) => s.text).join("\n");
const revoked = (fn: string) => new RegExp(`revoke\\s+(?:execute|all)\\s+on\\s+function\\s+(?:public\\.)?${fn}\\b[^;]*from\\s+[^;]*\\bpublic\\b`, "i").test(all);
const pinnedLater = (fn: string) => new RegExp(`alter\\s+function\\s+(?:public\\.)?${fn}\\b[^;]*set\\s+search_path`, "i").test(all);

/**
 * Exceptions, each with its reason. Adding one is a decision, not a fix.
 * current_member_id is called from RLS policies on stories/events/etc., so
 * every role that can hit those tables must be able to execute it; it is
 * security definer with search_path pinned, and returns only the caller's own
 * member id.
 */
const MAY_STAY_PUBLIC = new Set(["current_member_id"]);
/**
 * Invoker-rights maintenance functions executable only by service_role
 * (20260816000002), predating the search_path rule. Unpinned, but no caller
 * other than the job runner can reach them.
 */
const MAY_BE_UNPINNED = new Set(["ensure_analytics_partition", "site_sessions_last_year"]);

describe("migration function hygiene", () => {
  it("finds the functions it is meant to police (the parser still works)", () => {
    expect(created.size).toBeGreaterThan(10);
    expect([...created.keys()]).toEqual(expect.arrayContaining(["story_summary", "search_members", "apply_industry_backfill"]));
  });

  it("revokes EXECUTE from PUBLIC on every function", () => {
    const missing = [...created.keys()].filter((fn) => !MAY_STAY_PUBLIC.has(fn) && !revoked(fn));
    expect(missing).toEqual([]);
  });

  it("pins search_path on every function", () => {
    const missing = [...created]
      .filter(([fn, { header }]) => !MAY_BE_UNPINNED.has(fn) && !/set\s+search_path/i.test(header) && !pinnedLater(fn))
      .map(([fn, { file }]) => `${fn} (${file})`);
    expect(missing).toEqual([]);
  });

  it("story_summary keeps anon and authenticated, which its computed-field role needs", () => {
    expect(all).toMatch(/grant\s+execute\s+on\s+function\s+story_summary\(stories\)\s+to\s+anon,\s*authenticated/i);
  });
});
