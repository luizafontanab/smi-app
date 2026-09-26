import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Guards the stories↔members embed against PGRST201.
 *
 * `story_members` (migration 20260924000001) gave PostgREST a *second*
 * relationship between `stories` and `members`, so an unqualified
 * `member:members(...)` embed on a stories query became ambiguous and failed
 * the whole request. Because `src/lib/queries.ts` destructures `{ data }` and
 * discards `error` on every read, that surfaced as an empty news page rather
 * than an error — on production, with a clean browser console and nothing in
 * the server logs. Every embed of members *from stories* must name the FK.
 *
 * Two complementary checks, because neither alone is sufficient:
 *
 *  1. A window scan after each `from("stories")`, which catches the inline
 *     selects (console pages, jobs.ts).
 *  2. An explicit assertion on STORY_CARD, whose definition sits far from the
 *     `.from("stories")` that uses it, so no proximity scan would see it.
 *
 * What this cannot do is prove the absence of ambiguity: only the database
 * knows its foreign keys, and a *new* join table on some other pair would
 * reintroduce the same class of bug elsewhere. `pnpm verify:prod` runs the real
 * query against a real database and is the check that would catch that.
 */

const SRC = path.resolve(__dirname, "../../src");
const QUALIFIED = "members!stories_member_id_fkey";

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = sourceFiles(SRC).map((f) => ({ path: path.relative(SRC, f), text: readFileSync(f, "utf8") }));

describe("stories↔members embeds name their foreign key", () => {
  it("finds source files to scan (guards against the walker silently returning nothing)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every select within reach of a from(\"stories\") that embeds members is qualified", () => {
    const offenders: string[] = [];
    for (const { path: rel, text } of files) {
      // A statement's select can sit a line or two below the .from(), so take a
      // window rather than the single line.
      const WINDOW = 400;
      for (let i = text.indexOf('from("stories")'); i !== -1; i = text.indexOf('from("stories")', i + 1)) {
        const window = text.slice(i, i + WINDOW);
        if (!window.includes(":members(")) continue;
        if (window.includes(QUALIFIED)) continue;
        const line = text.slice(0, i).split("\n").length;
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(
      offenders,
      `Unqualified members embed on a stories query — PostgREST cannot choose between ` +
        `stories_member_id_fkey and story_members, so the query fails with PGRST201 and ` +
        `the page renders empty. Use member:${QUALIFIED}(...). Offenders:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("STORY_CARD is qualified — the constant the news, search and story pages all share", () => {
    const queries = files.find((f) => f.path === "lib/queries.ts");
    expect(queries, "src/lib/queries.ts not found").toBeDefined();
    const line = queries!.text.split("\n").find((l) => l.includes("const STORY_CARD"));
    expect(line, "STORY_CARD declaration not found — has it been renamed?").toBeDefined();
    expect(line).toContain(QUALIFIED);
  });

  it("leaves single-path embeds alone: videos, events and placements stay unqualified", () => {
    // Regression the other way — over-qualifying would be just as wrong, since
    // `members!stories_member_id_fkey` is meaningless on a videos query.
    const queries = files.find((f) => f.path === "lib/queries.ts")!.text;
    const videoCard = queries.split("\n").find((l) => l.includes("const VIDEO_CARD"));
    expect(videoCard).toContain(":members(");
    expect(videoCard).not.toContain(QUALIFIED);
  });
});
