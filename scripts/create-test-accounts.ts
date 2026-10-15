/**
 * Create one admin and one member login for manual testing.
 *
 * Deliberately NOT part of any seed: `seed-real.ts` used to create fixture
 * logins on whatever it was pointed at, which put a `role=admin` account with a
 * repo-published password onto production (HUMAN-TODO 17.1). That block is now
 * gated on `!REMOTE`, and this script exists instead — explicit, one purpose,
 * run on purpose.
 *
 *   pnpm accounts:test              # local
 *   pnpm accounts:test:prod         # production
 *   pnpm accounts:test:prod -- --password 'something-else'
 *
 * A hosted target is refused without --remote, whatever the shell's env points
 * at; accounts:test:prod passes it. Without that, a shell with production's env
 * still sourced turns `pnpm accounts:test` into an admin login on the live site.
 *
 * The password is an argument with a default rather than a constant in the
 * source, so the repository does not ship a working credential. It is still a
 * known, shared password: these are disposable test accounts, and they must be
 * deleted before launch. `pnpm audit:test-rows` finds them.
 *
 * Idempotent: an account that already exists is left alone, not recreated.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY not set");
// Local unless --remote, which only accounts:test:prod passes — the same rule the
// seeds and the industry backfill follow (scripts/lib/target-guard.ts).
assertScriptTarget(SUPABASE_URL, "the test-account script");
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const argIndex = process.argv.indexOf("--password");
const PASSWORD = argIndex > -1 ? process.argv[argIndex + 1] : "smi-test-2026";

const ADMIN_EMAIL = "admin@smi.test";
const MEMBER_EMAIL = "member@smi.test";
/**
 * The member login needs a company to own. `draft` deliberately: it gives the
 * dashboard a `member_id` to work with while `public_read_active_members` keeps
 * it out of the public directory, search and sitemap — the same reasoning the
 * seed uses for Media Co.
 */
const MEMBER_SLUG = "smi-test-company";

async function findUser(email: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function ensureUser(email: string, role: "admin" | "member", memberId: string | null, name: string) {
  const existing = await findUser(email);
  if (existing) {
    console.log(`= ${email} already exists (${existing}) — left alone`);
    return existing;
  }
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`${email}: ${error.message}`);
  const userId = data.user.id;
  const { error: pErr } = await db
    .from("profiles")
    .insert({ user_id: userId, role, member_id: memberId, display_name: name });
  if (pErr) {
    // Don't leave a half-created account behind — same rollback as provisionMember().
    await db.auth.admin.deleteUser(userId);
    throw new Error(`${email}: profile insert failed, account rolled back — ${pErr.message}`);
  }
  console.log(`+ ${email}  role=${role}${memberId ? `  member=${MEMBER_SLUG}` : ""}`);
  return userId;
}

async function main() {
  console.log(`— target: ${SUPABASE_URL}\n`);

  await ensureUser(ADMIN_EMAIL, "admin", null, "Test Admin");

  const { data: found, error: findErr } = await db
    .from("members")
    .select("id")
    .eq("slug", MEMBER_SLUG)
    .maybeSingle();
  if (findErr) throw findErr;

  let memberId = found?.id ?? null;
  if (!memberId) {
    const { data, error } = await db
      .from("members")
      .insert({ slug: MEMBER_SLUG, name: "SMI Test Company", status: "draft", contact_email: MEMBER_EMAIL })
      .select("id")
      .single();
    if (error) throw error;
    memberId = data.id;
    console.log(`+ member company ${MEMBER_SLUG} (draft)`);
  } else {
    console.log(`= member company ${MEMBER_SLUG} already exists — left alone`);
  }

  await ensureUser(MEMBER_EMAIL, "member", memberId, "SMI Test Company");

  console.log(`\n  ${ADMIN_EMAIL}  /  ${MEMBER_EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
  console.log(`\n  Shared, known password on a live database — delete these before launch.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
