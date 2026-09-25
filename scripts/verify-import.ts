/**
 * Post-import verification: compare the live database against the shaped
 * extract it was seeded from.
 *
 * The seed reports what it *tried* to do and warns rather than aborting on a
 * failed media upload, so "it finished" is not the same as "it is all there".
 * This reads both sides back and prints the differences, which is what makes a
 * shortfall a number on screen now rather than a 404 someone finds later.
 *
 * Read-only: it writes nothing to the database or storage.
 *
 * Usage (same env resolution as seed-real.ts — never pass keys on the CLI):
 *   pnpm verify:prod
 *   pnpm verify:import            # local
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAllObjects } from "./lib/storage-list";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_DIR = process.env.EXTRACT_DIR ?? path.resolve(HERE, "../../handover-extract");

// Mirrors seed-real.ts: load .env.local when run bare so a local check needs no
// ceremony. Production values must come from .env.production.local instead.
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

const seed = <T = Record<string, unknown>>(name: string): T[] =>
  JSON.parse(readFileSync(path.join(EXTRACT_DIR, "seed", name), "utf8")) as T[];

/** Row count, optionally restricted to rows where `notNull` is populated. */
const count = async (table: string, notNull?: string) => {
  const base = db.from(table).select("*", { count: "exact", head: true });
  const { count: n, error } = await (notNull ? base.not(notNull, "is", null) : base);
  if (error) throw new Error(`${table}: ${error.message}`);
  return n ?? 0;
};

const row = (label: string, actual: number, expected: number) => {
  const ok = actual === expected;
  const delta = actual - expected;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(30)} ${String(actual).padStart(6)} / ${String(expected).padEnd(6)}` +
      (ok ? "" : `  (${delta > 0 ? "+" : ""}${delta})`),
  );
  return ok;
};

async function main() {
  console.log(`— verifying ${SUPABASE_URL}`);
  console.log(`— against  ${EXTRACT_DIR}/seed\n`);

  const members = seed("members.seed.json");
  const stories = seed<{ member_wp_ids?: number[]; wp_member_id: number | null; cover_path: string | null }>(
    "stories.seed.json",
  );
  const videos = seed<{ thumbnail_path: string | null }>("videos.seed.json");
  const events = seed<{ lat: number | null; type: string | null; cover_path: string | null }>("events.seed.json");

  let allOk = true;
  const check = (...args: Parameters<typeof row>) => {
    allOk = row(...args) && allOk;
  };

  console.log("Row counts (live / expected)");
  check("members", await count("members"), members.length);
  // Name any member that exists on only one side. The seed adds a synthetic
  // company for the media@ login, so a small positive difference is expected —
  // but it has to be *seen* rather than assumed, because the same +1 would also
  // be how a duplicate or a stray hand-created row looked.
  {
    const { data, error } = await db.from("members").select("slug,name,status").order("slug");
    if (error) throw new Error(`members: ${error.message}`);
    const seedSlugs = new Set(members.map((m) => (m as { slug: string }).slug));
    const liveSlugs = new Set((data ?? []).map((m) => m.slug));
    const extra = (data ?? []).filter((m) => !seedSlugs.has(m.slug));
    const absent = members.map((m) => (m as { slug: string }).slug).filter((s) => !liveSlugs.has(s));
    if (extra.length) console.log(`      in DB, not in extract: ${extra.map((m) => `${m.slug} (${m.status})`).join(", ")}`);
    if (absent.length) console.log(`      in extract, not in DB: ${absent.join(", ")}`);
  }
  check("stories", await count("stories"), stories.length);
  check("videos", await count("videos"), videos.length);
  check("events", await count("events"), events.length);

  // Content alone does not make a page. The homepage and member/story pages are
  // layout-driven, so an empty page_layouts or settings renders a blank site
  // while every story row sits there intact — a failure that looks identical to
  // "the database is empty" from the outside.
  console.log("\nSupporting tables (a blank page with content present starts here)");
  for (const [table, min] of [
    ["page_layouts", 1],
    ["settings", 1],
    ["advert_slots", 1],
    ["static_pages", 1],
    ["categories", 1],
    ["services", 1],
    ["industries", 10],
    ["membership_types", 5],
  ] as const) {
    const n = await count(table);
    const ok = n >= min;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✓" : "✗"} ${table.padEnd(30)} ${String(n).padStart(6)}${ok ? "" : `  (expected at least ${min})`}`);
  }

  // Sections that render empty even when the import is perfect, because the
  // legacy site had nothing to give them. Reported explicitly so "missing
  // section" is answered with a reason rather than another bug hunt.
  console.log("\nHomepage sections (empty here = nothing to show, not a fault)");
  {
    const today = new Date().toISOString().slice(0, 10);
    const { count: upcoming } = await db
      .from("events")
      .select("*", { count: "exact", head: true })
      .gte("starts_on", today);
    const { count: sent } = await db
      .from("newsletter_issues")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent");
    const { count: machines } = await db
      .from("featured_machines")
      .select("*", { count: "exact", head: true })
      .eq("status", "published");
    const { count: placements } = await db
      .from("placements")
      .select("*", { count: "exact", head: true })
      .lte("starts_on", today)
      .gte("ends_on", today);
    const note = (label: string, n: number | null, why: string) =>
      console.log(`  ${(n ?? 0) > 0 ? "✓" : "–"} ${label.padEnd(30)} ${String(n ?? 0).padStart(6)}${(n ?? 0) > 0 ? "" : `   ${why}`}`);
    note("events (upcoming)", upcoming, "every imported event is historical — fix-list 67");
    note("newsletter_issues (sent)", sent, "the old site kept issues in Mailchimp, not the CMS");
    note("featured_machines (published)", machines, "authored content, not imported");
    note("placements (live today)", placements, "booked in the console, nothing to import");
    // home.grid.tsx renders the machine card only when a live featured_machine
    // placement resolves, and the newsletter strip only for sent issues that
    // have a web_slug — both silently absent otherwise.
    const { data: kinds } = await db
      .from("placements")
      .select("kind")
      .lte("starts_on", today)
      .gte("ends_on", today);
    const byKind = new Map<string, number>();
    for (const p of kinds ?? []) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
    console.log(`      live placements by kind: ${[...byKind].map(([k, n]) => `${k}=${n}`).join(", ") || "none"}`);
    const { count: withSlug } = await db
      .from("newsletter_issues")
      .select("*", { count: "exact", head: true })
      .eq("status", "sent")
      .not("web_slug", "is", null);
    console.log(`      sent newsletters with a web_slug (the strip needs these): ${withSlug ?? 0}`);
  }

  console.log("\nRelationships");
  const expectedLinks = stories.reduce((n, s) => n + (s.member_wp_ids?.length ?? 0), 0);
  check("story_members", await count("story_members"), expectedLinks);
  check(
    "stories with member_id",
    await count("stories", "member_id"),
    stories.filter((s) => s.wp_member_id != null).length,
  );

  console.log("\nFields that had no home before the migration");
  check(
    "members with brand_hex",
    await count("members", "brand_hex"),
    members.filter((m) => (m as { brand_hex: string | null }).brand_hex != null).length,
  );
  check(
    "events with coordinates",
    await count("events", "lat"),
    events.filter((e) => e.lat != null).length,
  );
  check(
    "events with a type",
    await count("events", "type"),
    events.filter((e) => e.type != null).length,
  );

  // Everything above ran with the secret key, which bypasses RLS — so it proves
  // the rows exist, not that the site can read them. The public pages use the
  // publishable key as the `anon` role, where RLS and table grants both apply.
  // A project can hold all 1,992 stories and still render an empty homepage.
  console.log("\nPublic read path (anon role — what the website actually sees)");
  const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!PUBLISHABLE) {
    console.log("  – skipped: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY not set");
  } else {
    const anon = createClient(SUPABASE_URL, PUBLISHABLE, { auth: { persistSession: false } });
    const anonCount = async (table: string, label: string, expected: number) => {
      const { count: n, error } = await anon.from(table).select("*", { count: "exact", head: true });
      if (error) {
        allOk = false;
        console.log(`  ✗ ${label.padEnd(30)} ERROR: ${error.message}`);
        return;
      }
      check(label, n ?? 0, expected);
    };
    // Mirrors the RLS policies: published content, active/grace members.
    await anonCount("stories", "stories (published)", await count("stories", undefined));
    await anonCount(
      "members",
      "members (active/grace)",
      (members as { status: string }[]).filter((m) => m.status === "active" || m.status === "grace").length,
    );
    await anonCount("industries", "industries", 10);

    // Run the real query the news page runs, embed and all. Counting rows is not
    // enough: an embed can fail on its own (PGRST201, ambiguous relationship)
    // while plain counts stay perfectly healthy, and queries.ts discards the
    // error — so the page renders empty while every check above passes.
    // Mirrors STORY_CARD in src/lib/queries.ts, FK-qualified embed included —
    // if this copy drifts from the app's, the check stops being evidence.
    const STORY_CARD =
      "id, slug, title, excerpt, cover_path, cover_focus, published_at, is_member_news, member:members!stories_member_id_fkey(slug, name, logo_path, status)";
    const { data, error } = await anon
      .from("stories")
      .select(STORY_CARD, { count: "exact" })
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .range(0, 11);
    if (error) {
      allOk = false;
      console.log(`  ✗ ${"news page query".padEnd(30)} ${error.code ?? ""} ${error.message}`);
      if (error.details) console.log(`      details: ${error.details}`);
      if (error.hint) console.log(`      hint: ${error.hint}`);
    } else {
      check("news page query (12 cards)", data?.length ?? 0, 12);
    }
  }

  // scripts/seed-real.ts creates fixture logins with a password hardcoded in the
  // repo. Unlike seedDemoRows it is NOT gated on --remote, so a production seed
  // silently provisions them there too — including an admin. Always report them.
  console.log("\nAuth accounts");
  {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw new Error(`auth: ${error.message}`);
    const users = data?.users ?? [];
    const fixtures = users.filter((u) => (u.email ?? "").endsWith("@smi.local"));
    console.log(`  ${users.length} account(s) total`);
    if (fixtures.length) {
      allOk = false;
      const { data: profs } = await db
        .from("profiles")
        .select("user_id,role")
        .in("user_id", fixtures.map((u) => u.id));
      const roleOf = new Map((profs ?? []).map((p) => [p.user_id, p.role]));
      console.log(`  ✗ ${fixtures.length} seed fixture login(s) with a repo-hardcoded password:`);
      for (const u of fixtures) console.log(`      ${u.email}  role=${roleOf.get(u.id) ?? "?"}`);
      console.log(`    These must not exist on a live database — see scripts/seed-real.ts mkUser().`);
    } else {
      console.log("  ✓ no @smi.local fixture logins");
    }
  }

  // Still a few thousand listings even walked concurrently — cheap enough to run
  // before go-live, not cheap enough to want on every quick check.
  if (process.argv.includes("--skip-media")) {
    console.log("\nMedia\n  – skipped (--skip-media)");
    console.log(allOk ? "\n✓ checks passed" : "\n✗ differences above");
    process.exitCode = allOk ? 0 : 1;
    return;
  }

  console.log("\nMedia");
  const referenced = new Set<string>();
  for (const m of members as { logo_path?: string; hero_path?: string }[])
    for (const p of [m.logo_path, m.hero_path]) if (p) referenced.add(p);
  for (const s of stories) if (s.cover_path) referenced.add(s.cover_path);
  for (const v of videos) if (v.thumbnail_path) referenced.add(v.thumbnail_path);
  for (const e of events) if (e.cover_path) referenced.add(e.cover_path);

  const present = await listAllObjects(db, "media");
  const missing = [...referenced].filter((p) => !present.has(p));
  check("objects in bucket", referenced.size - missing.length, referenced.size);
  if (missing.length) {
    console.log(`\n  ${missing.length} referenced file(s) missing from storage:`);
    for (const p of missing.slice(0, 20)) console.log(`    ${p}`);
    if (missing.length > 20) console.log(`    … and ${missing.length - 20} more`);
    console.log(`\n  Fix: pnpm seed:prod -- --media-only`);
  }

  console.log(allOk ? "\n✓ import matches the extract" : "\n✗ differences above");
  process.exitCode = allOk ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
