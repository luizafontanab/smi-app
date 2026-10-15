import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { must } from "../../scripts/lib/must";

/**
 * The seeds' writes must fail loudly. supabase-js resolves a rejected insert
 * to `{ error }` instead of throwing, so a bare `await db.from(t).insert(…)`
 * that fails is invisible — the seed prints "Seed complete." over missing
 * rows. The dev board's eight sample rows were lost that way on every local
 * seed (a NOT NULL column sent as null by the bulk insert), and the
 * story_members inserts could have gone the same way.
 *
 * The seeds are top-level scripts that need a fresh database, so they are
 * checked here as source: every awaited write goes through must().
 */
const seedSource = (file: string) => readFileSync(path.resolve(__dirname, "../../scripts", file), "utf8");

describe("must", () => {
  it("returns the result when the write succeeded, data included", async () => {
    const result = { data: [{ id: "x" }], error: null };
    await expect(must("stories", Promise.resolve(result))).resolves.toBe(result);
  });

  it("throws, naming the table, when supabase-js resolved with an error", async () => {
    await expect(must("story_members", Promise.resolve({ data: null, error: { message: "violates foreign key constraint" } }))).rejects.toThrow(
      "story_members: violates foreign key constraint",
    );
  });
});

describe.each(["seed.ts", "seed-real.ts"])("%s", (file) => {
  const src = seedSource(file);

  it("has no awaited database write whose error is ignored", () => {
    // A statement that starts with `await db` (optionally behind an `if`) is
    // one whose result nobody reads. Reads keep `const { data, error } = …`.
    const bare = src.split("\n").flatMap((line, i) => (/^\s*(?:if \(.*\) )?await db(?:\s*$|\.from\()/.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
    expect(bare).toEqual([]);
  });
});

describe("seed.ts specifics", () => {
  const src = seedSource("seed.ts");

  it("stamps paid_at on the invoices it seeds as paid", () => {
    const invoices = src.slice(src.indexOf('db.from("invoices").insert('), src.indexOf('db.from("notification_prefs")'));
    expect(invoices).toMatch(/status: k === 0 \? "issued" : "paid"/);
    expect(invoices).toMatch(/paid_at: k === 0 \? null : /);
  });

  it("lets the dev board rows take column defaults for the fields each one leaves out", () => {
    // Without it the bulk insert sends null for description/notes/context on
    // rows that omit them, and all three are NOT NULL — the whole insert fails.
    expect(src).toMatch(/db\.from\("dev_tasks"\)\.insert\(\[[^\]]*?(?:\][^\]]*?)*?\], \{ defaultToNull: false \}\)\)/);
  });
});
