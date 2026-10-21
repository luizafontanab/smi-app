import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every storage bucket the app uses must be created by a migration (HUMAN-TODO
 * 17.2). `media` and `invoices` used to exist only because the seed scripts
 * made them, so a schema-only setup — `db push` onto a fresh project — had no
 * buckets at all and every image 404'd. Static, like
 * migration-function-hygiene.test.ts: it reads the files, so it needs no
 * database and catches a new bucket before anything is applied.
 */
const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** Bucket id → its `public` flag, as the latest migration to insert it sets it. */
const created = new Map<string, boolean>();
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  const text = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
  for (const stmt of text.matchAll(/insert\s+into\s+storage\.buckets[\s\S]*?;/gi)) {
    for (const row of stmt[0].matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'[a-z0-9-]+'\s*,\s*(true|false)\b/gi)) {
      created.set(row[1], row[2].toLowerCase() === "true");
    }
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

/** Bucket names the app passes to storage.from(), literally or through a *_BUCKET constant. */
const used = new Set<string>();
for (const file of sourceFiles(path.join(ROOT, "src"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/storage\s*\.from\(\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]);
  for (const m of text.matchAll(/[A-Z_]*BUCKET[A-Z_]*\s*=\s*["']([a-z0-9-]+)["']/g)) used.add(m[1]);
}

describe("storage buckets", () => {
  it("finds the buckets the app uses (so the check below isn't vacuous)", () => {
    expect([...used].sort()).toEqual(expect.arrayContaining(["invoices", "media", "upload-staging"]));
  });

  it("creates every bucket the app uses in a migration, not only in a seed script", () => {
    const missing = [...used].filter((b) => !created.has(b));
    expect(missing, `buckets used in src/ with no migration creating them: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps media public and everything else private", () => {
    // media is served by public URL; invoices hold member names, addresses and
    // amounts; upload-staging holds bytes nobody has validated yet.
    expect(created.get("media")).toBe(true);
    expect(created.get("invoices")).toBe(false);
    expect(created.get("upload-staging")).toBe(false);
  });
});
