import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLocalSupabaseUrl } from "../../scripts/lib/target-guard";

/**
 * `isLocalSupabaseUrl` is now the single definition of "safe to write to",
 * consulted by both the seed scripts (scripts/lib/target-guard.ts) and the test
 * runner (tests/setup.ts). A false positive here means a seed run or a
 * `pnpm check` writes to a live database believing it is local — which is
 * exactly what happened on 25 Sep 2026, before the second caller existed.
 *
 * The hostile cases matter more than the happy ones: a hosted project whose
 * name merely *contains* "localhost" must not pass.
 */
describe("isLocalSupabaseUrl", () => {
  it("accepts the local stack in the forms supabase status reports", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:56321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:56321")).toBe(true);
    expect(isLocalSupabaseUrl("http://[::1]:56321")).toBe(true);
  });

  it("accepts a local host with no port and with a trailing path", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost/rest/v1")).toBe(true);
  });

  it("accepts https on a local host", () => {
    expect(isLocalSupabaseUrl("https://localhost:56321")).toBe(true);
  });

  it("rejects a hosted Supabase project", () => {
    expect(isLocalSupabaseUrl("https://bvyxeujhecxulzwvpxfr.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://kgjnwyojgajcvsberods.supabase.co")).toBe(false);
  });

  it("rejects a remote host that merely contains a local-looking name", () => {
    // The check is anchored, so none of these may slip through.
    expect(isLocalSupabaseUrl("https://localhost.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://not-localhost.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("https://127.0.0.1.evil.com")).toBe(false);
    expect(isLocalSupabaseUrl("https://example.com/?host=127.0.0.1")).toBe(false);
  });

  it("rejects an empty or malformed value rather than defaulting to permissive", () => {
    expect(isLocalSupabaseUrl("")).toBe(false);
    expect(isLocalSupabaseUrl("127.0.0.1:56321")).toBe(false); // no scheme
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });
});

/**
 * The guard only protects a script that calls it. Every script under scripts/
 * that builds a Supabase client loads .env.local only when the shell has no key
 * of its own, so a shell with production's env still sourced points the plain
 * "local" command at the live database. Pinned here, by reading the sources:
 * each one is a guarded writer, a seed, or verifiably read-only — so a new
 * script that writes without a guard fails this rather than reaching production.
 */
describe("scripts/ that open a Supabase client", () => {
  const SCRIPTS = path.resolve(__dirname, "../../scripts");
  const PKG = JSON.parse(readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { scripts: Record<string, string> };
  const source = (file: string) => readFileSync(path.join(SCRIPTS, file), "utf8");

  /** Writers behind assertScriptTarget, with the package script that runs each locally. */
  const GUARDED: Record<string, string> = {
    "backfill-industries.ts": "industries:backfill",
    "backfill-coordinates.ts": "coordinates:backfill",
    "create-test-accounts.ts": "accounts:test",
    "remove-sample-adverts.ts": "remove-sample-adverts",
    "audit-test-rows.ts": "audit:test-rows",
    "import-sources.ts": "sources:import",
    "import-mailchimp.ts": "contacts:import-mailchimp",
  };
  /** Behind assertSeedTarget, which has the same --remote rule. */
  const SEEDS = ["seed.ts", "seed-real.ts"];
  /** Reads only — checked below, not taken on trust. */
  const READ_ONLY = ["verify-import.ts"];

  const opensClient = (src: string) => /^(?!import).*\bcreateClient\(/m.test(src);
  const clientScripts = readdirSync(SCRIPTS).filter((f) => /\.(ts|mjs)$/.test(f) && opensClient(source(f)));

  it("are all accounted for — a new one must be guarded or added as read-only", () => {
    expect(clientScripts.sort()).toEqual([...Object.keys(GUARDED), ...SEEDS, ...READ_ONLY].sort());
  });

  it.each(Object.keys(GUARDED))("%s calls assertScriptTarget before it builds the client", (file) => {
    const src = source(file);
    const guard = src.search(/^assertScriptTarget\(SUPABASE_URL, /m);
    const client = src.search(/^const db = createClient\(/m);
    expect(guard).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(guard);
  });

  it.each(SEEDS)("%s calls assertSeedTarget before it builds the client", (file) => {
    const src = source(file);
    const guard = src.search(/^assertSeedTarget\(SUPABASE_URL\);/m);
    expect(guard).toBeGreaterThan(-1);
    expect(src.search(/^const db = createClient\(/m)).toBeGreaterThan(guard);
  });

  it.each(Object.entries(GUARDED))("%s: only %s:prod passes --remote", (file, name) => {
    expect(PKG.scripts[`${name}:prod`]).toMatch(new RegExp(`^set -a && \\. \\./\\.env\\.production\\.local && set \\+a && tsx scripts/${file.replace(".", "\\.")} --remote$`));
    expect(PKG.scripts[name]).toBe(`tsx scripts/${file}`);
  });

  it.each(READ_ONLY)("%s really is read-only — no write call against the database or storage", (file) => {
    expect(source(file)).not.toMatch(/\.(insert|update|upsert|delete|rpc|upload|remove|move|copy)\(/);
  });
});
