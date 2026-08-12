/**
 * Seed local Supabase with REAL content extracted from the old WordPress site
 * (see /Users/zafontana/SMI/handover-extract — run its extract + shape-seed
 * scripts first). Alternative to seed.ts: real members/stories/videos/events
 * plus the minimal infra rows (auth users, advert slots, settings, layouts) and
 * SAMPLE-stamped adverts so the slots have something to rotate (--no-adverts
 * skips them). Other synthetic operational data (analytics, newsletters,
 * contacts) is NOT seeded — run seed.ts instead when demoing those consoles.
 *
 * Local dev only, expects a fresh DB (supabase db reset).
 * Run: pnpm exec tsx scripts/seed-real.ts [--stories-limit N] [--skip-media]
 *        [--no-adverts]    seed everything except the sample adverts
 *        [--adverts-only]  add sample adverts to an already-seeded DB, nothing else
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svgBanner } from "./lib/placeholder-art";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_DIR = process.env.EXTRACT_DIR ?? path.resolve(HERE, "../../handover-extract");

// load .env.local when run bare
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const envFile = path.resolve(HERE, "../.env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set (load .env.local)");
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const STORIES_LIMIT = arg("--stories-limit") ? parseInt(arg("--stories-limit")!, 10) : Infinity;
const SKIP_MEDIA = process.argv.includes("--skip-media");
// --no-adverts: leave the advert inventory empty, to check the unsold state
const NO_ADVERTS = process.argv.includes("--no-adverts");
// --adverts-only: add sample adverts to an already-seeded DB without a reset
const ADVERTS_ONLY = process.argv.includes("--adverts-only");
// --media-only: (re)upload referenced media without touching any table — for
// backfilling after a failed/skipped upload pass on an already-seeded DB
const MEDIA_ONLY = process.argv.includes("--media-only");

const seed = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(EXTRACT_DIR, "seed", name), "utf8"));

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
};

/**
 * Sample adverts so the slots have something to rotate. The artwork is branded
 * with REAL member companies who have bought nothing, hence the SAMPLE stamp.
 * Rotation stays uniform — nothing here weights or prioritises a slot.
 */
async function seedAdverts(
  memberRows: (Record<string, unknown> & { wp_member_id: number; slug: string })[],
  memberId: (wp: number | null | undefined) => string | null,
) {
  const adMembers = memberRows.filter((m) => m.status === "active" && memberId(m.wp_member_id));
  const palette = ["#1e3a5f", "#7c2d12", "#14532d", "#581c87", "#7f1d1d", "#0c4a6e", "#3f6212", "#701a75"];
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthsAhead = new Date(today); monthsAhead.setMonth(monthsAhead.getMonth() + 2);
  const monthsAgo = new Date(today); monthsAgo.setMonth(monthsAgo.getMonth() - 2);
  const putSvg = async (p: string, body: Buffer) => {
    const { error } = await db.storage.from("media").upload(p, body, { contentType: "image/svg+xml", upsert: true });
    if (error) throw new Error(`upload ${p}: ${error.message}`);
    return p;
  };
  const banners = adMembers.slice(0, 8);
  const logos = adMembers.slice(8, 13);
  console.log(`— sample adverts (${banners.length} banners, ${logos.length} supplier logos)`);

  for (let i = 0; i < banners.length; i++) {
    const m = banners[i];
    const name = String(m.name);
    const { data: adv, error: advErr } = await db
      .from("advertisers")
      .insert({ name, member_id: memberId(m.wp_member_id), contact_email: `sales@${m.slug}.example` })
      .select("id").single();
    if (advErr) throw advErr;
    const [dPath, mPath] = await Promise.all([
      putSvg(`panels/panel-${i}-wide.svg`, svgBanner(name, 1280, 170, palette[i], { sample: true })),
      putSvg(`panels/panel-${i}-narrow.svg`, svgBanner(name, 370, 280, palette[i], { sample: true })),
    ]);
    const { data: ad, error: adErr } = await db
      .from("adverts")
      .insert({ advertiser_id: adv!.id, name: `${name} banner`, desktop_path: dPath, mobile_path: mPath, format: "banner" })
      .select("id").single();
    if (adErr) throw adErr;
    // last two expire within the week, so the console's expiry view has something to show
    await db.from("advert_bookings").insert({
      advert_id: ad!.id,
      starts_on: iso(monthsAgo),
      ends_on: i < 6 ? iso(monthsAhead) : iso(new Date(today.getTime() + 5 * 864e5)),
    });
  }

  for (let i = 0; i < logos.length; i++) {
    const m = logos[i];
    const name = String(m.name);
    const { data: adv, error: advErr } = await db
      .from("advertisers").insert({ name, member_id: memberId(m.wp_member_id) }).select("id").single();
    if (advErr) throw advErr;
    const p = await putSvg(`panels/mark-${i}.svg`, svgBanner(name.split(" ")[0], 240, 120, palette[(i + 3) % 8], { sample: true }));
    const { data: ad, error: adErr } = await db
      .from("adverts")
      .insert({ advertiser_id: adv!.id, name: `${name} supplier logo`, desktop_path: p, mobile_path: p, format: "supplier_logo" })
      .select("id").single();
    if (adErr) throw adErr;
    await db.from("advert_bookings").insert({ advert_id: ad!.id, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
  }
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function uploadMedia(
  // Record<string, unknown> so MemberRow assigns — an all-optional literal trips
  // TS's weak-type check, since MemberRow declares neither path up front.
  memberRows: Record<string, unknown>[],
  storyRows: { cover_path: string | null }[],
  videoRows: Record<string, unknown>[],
  eventRows: Record<string, unknown>[],
  manifest: { source: string; storage_path: string }[],
) {
  // upload only media referenced by the rows being seeded
  const wanted = new Set<string>();
  for (const m of memberRows) for (const p of [m.logo_path, m.hero_path]) if (p) wanted.add(p as string);
  for (const s of storyRows) if (s.cover_path) wanted.add(s.cover_path);
  for (const v of videoRows) if (v.thumbnail_path) wanted.add(v.thumbnail_path as string);
  for (const e of eventRows) if (e.cover_path) wanted.add(e.cover_path as string);
  const uploads = manifest.filter((m) => wanted.has(m.storage_path));
  console.log(`— media: uploading ${uploads.length} files`);
  let done = 0, failed = 0;
  for (const batch of chunk(uploads, 8)) {
    await Promise.all(
      batch.map(async (m) => {
        try {
          const body = await readFile(path.join(EXTRACT_DIR, "uploads", m.source));
          const ext = m.storage_path.split(".").pop() ?? "jpg";
          const { error } = await db.storage
            .from("media")
            .upload(m.storage_path, body, { contentType: MIME[ext] ?? "application/octet-stream", upsert: true });
          if (error) throw error;
        } catch (err) {
          failed++;
          if (failed <= 5) console.warn(`  upload failed ${m.storage_path}: ${(err as Error).message}`);
        } finally {
          if (++done % 400 === 0) console.log(`  ${done}/${uploads.length}`);
        }
      }),
    );
  }
  if (failed) console.warn(`— media: ${failed} uploads failed (rows keep their paths; images 404 until re-run with --media-only)`);
}

async function main() {
  console.log(`— real-content seed from ${EXTRACT_DIR}`);
  // storage can lag behind kong for a while after `supabase db reset`
  for (let i = 0; ; i++) {
    const { error } = await db.storage.listBuckets();
    if (!error) break;
    if (i >= 30) throw new Error(`storage API not ready after 60s: ${error.message}`);
    if (i === 0) console.log("— waiting for storage API…");
    await new Promise((r) => setTimeout(r, 2000));
  }
  await db.storage.createBucket("media", { public: true }).catch(() => {});

  type Cat = { kind: string; slug: string; name: string };
  type MemberRow = Record<string, unknown> & { wp_member_id: number; slug: string; category_slugs: string[] };
  type StoryRow = Record<string, unknown> & { wp_member_id: number | null; slug: string; category_slugs: string[]; cover_path: string | null };
  type Manifest = { source: string; storage_path: string; used_by: string }[];

  const [catRows, memberRows, storyRowsAll, videoRows, eventRows, pageRows, manifest] = await Promise.all([
    seed<Cat[]>("categories.seed.json"),
    seed<MemberRow[]>("members.seed.json"),
    seed<StoryRow[]>("stories.seed.json"),
    seed<Record<string, unknown>[]>("videos.seed.json"),
    seed<Record<string, unknown>[]>("events.seed.json"),
    seed<{ slug: string; title: string; body: string }[]>("static_pages.seed.json"),
    seed<Manifest>("media-manifest.json"),
  ]);
  const storyRows = storyRowsAll.slice(0, STORIES_LIMIT);
  if (storyRows.length < storyRowsAll.length)
    console.log(`— stories limited to ${storyRows.length} of ${storyRowsAll.length} (newest first)`);

  if (MEDIA_ONLY) {
    await uploadMedia(memberRows, storyRows, videoRows, eventRows, manifest);
    return;
  }

  if (ADVERTS_ONLY) {
    // members already exist — rebuild the wp_member_id → uuid map by slug
    const { data, error } = await db.from("members").select("id, slug");
    if (error) throw error;
    const bySlug = new Map(data!.map((m) => [m.slug, m.id]));
    const wpMap = new Map(memberRows.flatMap((m) => (bySlug.has(m.slug) ? [[m.wp_member_id, bySlug.get(m.slug)!] as const] : [])));
    await seedAdverts(memberRows, (wp) => (wp ? wpMap.get(wp) ?? null : null));
    return;
  }

  console.log(`— categories (${catRows.length})`);
  const { data: cats, error: catErr } = await db.from("categories").upsert(catRows, { onConflict: "kind,slug" }).select();
  if (catErr) throw catErr;
  const catId = (kind: string, slug: string) => cats!.find((c) => c.kind === kind && c.slug === slug)?.id ?? null;

  console.log(`— members (${memberRows.length})`);
  const wpToUuid = new Map<number, string>();
  for (const rows of chunk(memberRows, 100)) {
    const insert = rows.map(({ wp_member_id, category_slugs, ...r }) => ({
      ...r,
      category_id: category_slugs.length ? catId("member", category_slugs[0]) : null,
    }));
    const { data, error } = await db.from("members").insert(insert).select("id, slug");
    if (error) throw error;
    for (const m of data!) wpToUuid.set(rows.find((r) => r.slug === m.slug)!.wp_member_id, m.id);
  }
  const memberId = (wp: number | null | undefined) => (wp ? wpToUuid.get(wp) ?? null : null);

  if (!NO_ADVERTS) await seedAdverts(memberRows, memberId);

  console.log("— auth users (admin, media input-only, 3 member logins on real members)");
  const mkUser = async (email: string, role: string, member_id: string | null, display_name: string) => {
    const { data, error } = await db.auth.admin.createUser({ email, password: "local-dev-password", email_confirm: true });
    if (error) throw error;
    await db.from("profiles").insert({ user_id: data.user.id, role, member_id, display_name });
  };
  await mkUser("jas@smi.local", "super_admin", null, "Jas");
  await mkUser("media@smi.local", "input_only", null, "Media Co");
  const activeSeed = memberRows.filter((m) => m.status === "active");
  for (let i = 0; i < Math.min(3, activeSeed.length); i++) {
    const m = activeSeed[i];
    await mkUser(`member${i + 1}@smi.local`, "member", memberId(m.wp_member_id), String(m.name));
  }

  if (SKIP_MEDIA) {
    console.log("— media: skipped");
  } else {
    await uploadMedia(memberRows, storyRows, videoRows, eventRows, manifest);
  }

  console.log(`— stories (${storyRows.length})`);
  for (const rows of chunk(storyRows, 100)) {
    const insert = rows.map(({ wp_member_id, category_slugs, ...r }) => ({ ...r, member_id: memberId(wp_member_id) }));
    const { data, error } = await db.from("stories").insert(insert).select("id, slug");
    if (error) throw error;
    const junctions = data!.flatMap((st) => {
      const src = rows.find((r) => r.slug === st.slug)!;
      return src.category_slugs
        .map((slug) => catId("story", slug))
        .filter(Boolean)
        .map((category_id) => ({ story_id: st.id, category_id }));
    });
    if (junctions.length) {
      const { error: jErr } = await db.from("story_categories").insert(junctions);
      if (jErr) throw jErr;
    }
  }

  console.log(`— videos (${videoRows.length}) + events (${eventRows.length})`);
  for (const rows of chunk(videoRows, 200)) {
    const insert = rows.map(({ wp_member_id, ...r }) => ({ ...r, member_id: memberId(wp_member_id as number | null) }));
    const { error } = await db.from("videos").insert(insert);
    if (error) throw error;
  }
  const { error: evErr } = await db.from("events").insert(eventRows);
  if (evErr) throw evErr;

  console.log(`— static pages (${pageRows.length})`);
  const { error: pgErr } = await db.from("static_pages").upsert(pageRows, { onConflict: "slug" });
  if (pgErr) throw pgErr;

  console.log("— infra: advert slots, settings, page layouts");
  await db.from("advert_slots").insert([
    { key: "home_1", label: "Homepage banner 1", cap: 3 },
    { key: "home_2", label: "Homepage banner 2", cap: 3 },
    { key: "home_3", label: "Homepage banner 3", cap: 3 },
    { key: "siderail_a", label: "Side rail A", cap: 3 },
    { key: "siderail_b", label: "Side rail B", cap: 3 },
    { key: "news_mid", label: "News mid-page", cap: 3 },
    { key: "footer", label: "Footer banner", cap: 3 },
    { key: "supplier_logos", label: "Supplier logos", cap: 8 },
  ]); // story_ad_* / member_ad_* / machine_ad_* come from migration 20260810000002;
  // videos_mid / events_mid / directory_mid from 20260811000002
  await db.from("settings").insert([
    { key: "grid", value: { blocks: 12, mix: { news: 6, video: 2, member_news: 2, featured_member: 1, featured_machine: 1 } } },
    { key: "social_caps", value: { per_day: 3, delay_minutes: 30 } },
  ]);
  const { DEFAULT_LAYOUTS } = await import("../src/lib/blocks/defaults");
  await db.from("page_layouts").insert(
    Object.entries(DEFAULT_LAYOUTS).map(([page_type, layout]) => ({ page_type, entity_id: null, layout })),
  );

  console.log("Real-content seed complete.");
  const counts = await Promise.all(
    ["members", "stories", "videos", "events", "categories", "static_pages"].map(
      async (t) => `${t}=${(await db.from(t).select("*", { count: "exact", head: true })).count}`,
    ),
  );
  console.log(counts.join(" "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
