import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Guards the members↔industries embed against PGRST201 — the same failure
 * story-member-embed.test.ts guards for stories↔members.
 *
 * `member_industries` (migration 20261012000001) gave PostgREST a *second*
 * relationship between `members` and `industries`, next to the
 * `members.industry_id` foreign key. An unqualified `industry:industries(...)`
 * embed on a members row is then ambiguous and fails the whole request — and
 * because `src/lib/queries.ts` discards `error`, a member profile 404s and the
 * directory renders empty instead of anything visibly breaking.
 *
 * The rule: wherever the row that embeds `industries` is a member — a query on
 * `members`, or a `members(...)` embed nested in another table's select — the
 * embed must name `industries!members_industry_id_fkey`. Stories, videos and
 * events have a single path to industries and stay unqualified, as does an
 * embed from `member_industries` itself.
 *
 * A source scan can't prove there is no ambiguity elsewhere — only the
 * database knows its foreign keys. scripts/verify-import.ts runs the real
 * directory query against a real database for that.
 */

const SRC = path.resolve(__dirname, "../../src");
const QUALIFIED = "industries!members_industry_id_fkey(";

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = sourceFiles(SRC).map((f) => ({ path: path.relative(SRC, f), text: readFileSync(f, "utf8") }));

/** The embed or call whose parentheses enclose `index` — e.g. `member:members` or `select`. */
function enclosingName(text: string, index: number): string {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) return /[\w:!]*$/.exec(text.slice(Math.max(0, i - 80), i))![0];
      depth--;
    }
  }
  return "";
}

/** The table of the nearest preceding `from("…")`. */
function rootTable(text: string, index: number): string | null {
  const before = text.slice(Math.max(0, index - 600), index);
  const all = [...before.matchAll(/from\("([a-z_]+)"\)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/** Every unqualified `industries(` embed whose row is a member. */
function offenders(): string[] {
  const out: string[] = [];
  for (const { path: rel, text } of files) {
    for (const m of text.matchAll(/:industries\(/g)) {
      const at = m.index! + 1; // at the "industries(" itself
      const parent = enclosingName(text, at + "industries".length);
      const memberRow =
        /(^|:)members(!\w+)?$/.test(parent) || // nested in a members(...) embed
        ((parent === "select" || parent.endsWith(".select")) && rootTable(text, at) === "members");
      if (memberRow) out.push(`${rel}:${text.slice(0, at).split("\n").length}`);
    }
  }
  return out;
}

describe("members↔industries embeds name their foreign key", () => {
  it("finds source files to scan (guards against the walker silently returning nothing)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds the qualified embeds it is meant to be guarding", () => {
    // If these vanish the scan below passes vacuously.
    const qualified = files.reduce((n, f) => n + f.text.split(QUALIFIED).length - 1, 0);
    expect(qualified).toBeGreaterThanOrEqual(4);
  });

  it("every industries embed on a member row is qualified", () => {
    const found = offenders();
    expect(
      found,
      `Unqualified industries embed on a members row — PostgREST cannot choose between ` +
        `members_industry_id_fkey and member_industries, so the query fails with PGRST201 ` +
        `and the page renders empty. Use industry:${QUALIFIED}...). Offenders:\n  ${found.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the scan catches both shapes it is written for", () => {
    // A self-test on synthetic source, so a broken scanner can't hide behind
    // the real code happening to be clean.
    const direct = 'db.from("members").select("id, industry:industries(name)")';
    const nested = 'db.from("placements").select("kind, member:members(slug, industry:industries(name))")';
    const fine = 'db.from("stories").select("id, member:members!stories_member_id_fkey(slug), industry:industries(slug)")';
    const viaJoin = 'db.from("members").select("id, member_industries(industry:industries(slug))")';
    const check = (text: string) => {
      files.push({ path: "__synthetic__.ts", text });
      try {
        return offenders().filter((o) => o.startsWith("__synthetic__"));
      } finally {
        files.pop();
      }
    };
    expect(check(direct)).toHaveLength(1);
    expect(check(nested)).toHaveLength(1);
    expect(check(fine)).toHaveLength(0);
    expect(check(viaJoin)).toHaveLength(0);
  });
});
