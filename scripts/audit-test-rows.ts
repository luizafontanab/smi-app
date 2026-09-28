/**
 * Find — and optionally remove — rows that the integration test suites wrote to
 * whatever database `.env.local` happened to point at.
 *
 * Why this exists. `vitest.config.ts` loads `.env.local` into the test
 * environment, and eight suites under `tests/unit/` are integration tests that
 * insert real rows, gated only on `SUPABASE_SECRET_KEY` being present — not on
 * the target being local. With production credentials in `.env.local`, an
 * ordinary `pnpm check` writes members, adverts, contacts and inbox messages
 * straight into the live database. That happened on 25 Sep 2026.
 *
 * The damage is additive: these suites insert and (mostly) clean up after
 * themselves, and none of them updates or deletes imported content. This script
 * is the audit that proves that, and the tool that clears what was left behind.
 *
 *   pnpm audit:test-rows            # local  (dry run)
 *   pnpm audit:test-rows:prod       # prod   (dry run)
 *   pnpm audit:test-rows:prod -- --delete
 *
 * Deletion is opt-in and prints every row it will remove first.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const DELETE = process.argv.includes("--delete");

/**
 * Each suite's signature. Patterns are the literal prefixes the tests build
 * their fixtures from — see the `tests/unit/*.test.ts` named beside each.
 */
const MEMBER_SLUG_PREFIXES = [
  "cancel-nosub-", // join-funnel
  "cancel-test-", // join-funnel
  "comp-test-ltd-", // join-funnel
  "join-test-ltd-", // join-funnel
  "expired-comp-", // join-funnel
  "overlap-test-", // advert-bookings-overlap
  "notify-test-", // notify-member
];
const TEST_EMAIL_DOMAINS = ["@test.local", "@x.test"];

type Row = { id: string; [k: string]: unknown };

const rowsMatching = async (table: string, column: string, patterns: string[]): Promise<Row[]> => {
  const found = new Map<string, Row>();
  for (const p of patterns) {
    const { data, error } = await db.from(table).select("*").ilike(column, `${p}%`);
    if (error) throw new Error(`${table}.${column} ~ ${p}: ${error.message}`);
    for (const r of (data ?? []) as Row[]) found.set(r.id, r);
  }
  return [...found.values()];
};

const rowsEndingWith = async (table: string, column: string, suffixes: string[]): Promise<Row[]> => {
  const found = new Map<string, Row>();
  for (const s of suffixes) {
    const { data, error } = await db.from(table).select("*").ilike(column, `%${s}`);
    if (error) throw new Error(`${table}.${column} ~ ${s}: ${error.message}`);
    for (const r of (data ?? []) as Row[]) found.set(r.id, r);
  }
  return [...found.values()];
};

async function main() {
  console.log(`— auditing ${SUPABASE_URL}`);
  console.log(DELETE ? "— MODE: delete\n" : "— MODE: dry run (pass --delete to remove)\n");

  const members = await rowsMatching("members", "slug", MEMBER_SLUG_PREFIXES);
  const contacts = await rowsEndingWith("contacts", "email", TEST_EMAIL_DOMAINS);
  const signups = await rowsEndingWith("newsletter_signups", "email", TEST_EMAIL_DOMAINS);
  const inbox = await rowsEndingWith("inbox_messages", "email", TEST_EMAIL_DOMAINS);
  const promos = await rowsMatching("promo_codes", "code", ["SMI-FREE-"]);
  const issues = await rowsMatching("newsletter_issues", "subject", ["Idempotency test"]);

  const groups: [string, Row[], (r: Row) => string][] = [
    ["members", members, (r) => `${r.slug} (${r.status})`],
    ["contacts", contacts, (r) => String(r.email)],
    ["newsletter_signups", signups, (r) => String(r.email)],
    ["inbox_messages", inbox, (r) => `${r.kind} ${r.email}`],
    ["promo_codes", promos, (r) => String(r.code)],
    ["newsletter_issues", issues, (r) => `#${r.number} ${r.subject}`],
  ];

  let total = 0;
  for (const [table, rows, label] of groups) {
    total += rows.length;
    console.log(`${rows.length > 0 ? "✗" : "✓"} ${table.padEnd(20)} ${String(rows.length).padStart(4)} test row(s)`);
    for (const r of rows.slice(0, 8)) console.log(`      ${label(r)}`);
    if (rows.length > 8) console.log(`      … and ${rows.length - 8} more`);
  }

  if (total === 0) {
    console.log("\n✓ no test-created rows found");
    return;
  }

  if (!DELETE) {
    console.log(`\n${total} test row(s) found. Re-run with --delete to remove them.`);
    console.log("Imported content is never touched: these suites only insert.");
    process.exitCode = 1;
    return;
  }

  // Members cascade to adverts, advert_bookings, profiles and notifications, so
  // deleting the member row clears the suites' child rows with it.
  for (const [table, rows] of groups) {
    if (!rows.length) continue;
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await db.from(table).delete().in("id", ids.slice(i, i + 100));
      if (error) throw new Error(`delete ${table}: ${error.message}`);
    }
    console.log(`— deleted ${rows.length} from ${table}`);
  }
  console.log("\n✓ removed. Re-run `pnpm verify:prod` to confirm the import still matches.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
