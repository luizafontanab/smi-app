/**
 * Reconcile the agency's Mailchimp audience export with `contacts` (gap review
 * area 7, GAPS B5.13). The rules are in scripts/lib/mailchimp-import.ts; the
 * short version is that it never puts anyone back on the list.
 *
 *   pnpm contacts:import-mailchimp <export dir>              # local, dry run
 *   pnpm contacts:import-mailchimp <export dir> --apply      # local, writes
 *   pnpm contacts:import-mailchimp:prod <export dir> [--apply]
 *
 * <export dir> is the unzipped Mailchimp export: its subscribed_…, unsubscribed_…
 * and cleaned_… CSV files. Run it after the Bigin first import, so contacts
 * that are in both are matched rather than counted as new. Safe to re-run
 * (on the cutover delta export, say): what's already applied is unchanged.
 *
 * The export holds personal data — keep it out of the project tree and delete
 * it once the import is done (docs/GDPR.md).
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows } from "../src/lib/db/all-rows";
import { planMailchimpImport, readExportFile, statusOfFile, type LocalContact, type MailchimpMember } from "./lib/mailchimp-import";
import { must } from "./lib/must";
import { assertScriptTarget } from "./lib/target-guard";

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

const APPLY = process.argv.includes("--apply");
const dir = process.argv.slice(2).find((a) => !a.startsWith("--"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY not set");
// Local unless --remote, which only contacts:import-mailchimp:prod passes (scripts/lib/target-guard.ts).
assertScriptTarget(SUPABASE_URL, "the Mailchimp import");
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

async function main() {
  if (!dir || !existsSync(dir)) throw new Error("Usage: pnpm contacts:import-mailchimp <unzipped export dir> [--apply]");
  console.log(`— target: ${SUPABASE_URL}${APPLY ? "  (--apply)" : "  (dry run)"}`);

  const skipped: string[] = [];
  const members: MailchimpMember[] = [];
  const found: string[] = [];
  for (const file of readdirSync(dir)) {
    const status = statusOfFile(file);
    if (!status) continue;
    found.push(`${file} (${status})`);
    members.push(...readExportFile(readFileSync(path.join(dir, file), "utf8"), status, file, skipped));
  }
  if (!found.length) throw new Error(`No subscribed_/unsubscribed_/cleaned_ CSV files in ${dir}`);
  console.log(`— files: ${found.join(", ")}`);
  // All three, or an unsubscribe or bounce list could be silently missing.
  for (const status of ["subscribed", "unsubscribed", "cleaned"]) {
    if (!found.some((f) => f.endsWith(`(${status})`))) console.warn(`  ⚠ no ${status} file — is the export complete?`);
  }

  const { data: cursor } = await must("settings", db.from("settings").select("key").eq("key", "crm_sync_cursor").maybeSingle());
  if (!cursor) console.warn("  ⚠ the Bigin first import hasn't run here: contacts in both Bigin and Mailchimp will count as new. Run it first.");

  const locals = await allRows<LocalContact>(async (from, to) =>
    must("contacts", db.from("contacts").select("id, email, subscribed, unsubscribed_at, bounced_at, opt_in_at, opt_in_source").order("id").range(from, to)),
  );
  const plan = planMailchimpImport(members, locals);
  plan.skipped.push(...skipped);

  const { counts } = plan;
  console.log(`— ${counts.read} rows read, ${locals.length} contacts here`);
  console.log(`  new contacts:       ${counts.added.subscribed} subscribed, ${counts.added.unsubscribed} unsubscribed, ${counts.added.cleaned} bounced`);
  console.log(`  now unsubscribed:   ${counts.unsubscribed} (opted out in Mailchimp, still on our list)`);
  console.log(`  now bounced:        ${counts.bounced}`);
  console.log(`  consent evidence:   ${counts.evidenced} given Mailchimp's opt-in date`);
  console.log(`  left off the list:  ${counts.keptOff} subscribed in Mailchimp but off ours — never re-subscribed`);
  console.log(`  unchanged:          ${counts.unchanged}`);
  for (const line of plan.skipped) console.log(`  skipped: ${line}`);

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to write the above.");
    return;
  }

  for (let i = 0; i < plan.inserts.length; i += 500) {
    await must("contacts insert", db.from("contacts").insert(plan.inserts.slice(i, i + 500)));
  }
  for (const u of plan.updates) {
    await must(`contacts update ${u.id}`, db.from("contacts").update(u.patch).eq("id", u.id));
  }
  console.log(`\nApplied: ${plan.inserts.length} added, ${plan.updates.length} updated.`);
  console.log("New contacts and new opt-outs are marked for Bigin; the next crm_sync run pushes them, 50 a run.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
