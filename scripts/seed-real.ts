/**
 * Seed local Supabase with REAL content extracted from the old WordPress site
 * (see /Users/zafontana/SMI/handover-extract — run its extract + shape-seed
 * scripts first). Alternative to seed.ts: real members/stories/video/event
 * plus the minimal infra rows (auth users, advert slots, settings, layouts) and
 * SAMPLE-stamped adverts so the slots have something to rotate (--no-adverts
 * skips them). Other synthetic operational data (analytics, newsletters,
 * contacts) is NOT seeded — run seed.ts instead when demoing those consoles.
 *
 * Expects a fresh DB (supabase db reset). Defaults to local; seeding a hosted
 * project needs --remote (see `pnpm seed:prod`).
 *
 * Local runs default to a representative subset (150 newest stories) so the
 * local DB/Storage volume doesn't balloon to the full real dataset; --remote
 * runs (the actual hosted site) default to everything. --stories-limit N
 * overrides either default explicitly.
 *
 * Run: pnpm exec tsx scripts/seed-real.ts [--stories-limit N] [--skip-media]
 *        [--no-adverts]    seed everything except the sample adverts
 *        [--adverts-only]  add sample adverts to an already-seeded DB, nothing else
 *        [--pages-only]    upsert static pages into an already-seeded DB, nothing else
 *        [--remote]        allow a non-localhost target; also lifts the story cap
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "@/lib/auth";
import { svgBanner } from "./lib/placeholder-art";
import { AUTHORED_STATIC_PAGES } from "./lib/static-page-content";
import { assertSeedTarget } from "./lib/target-guard";
import { INDUSTRY_ROWS, industrySlug } from "./lib/industries";
import { industryForServices } from "./lib/industry-map";
import { selectMembers } from "./lib/select-members";
import { AUTHORED_EVENT_COORDS } from "./lib/event-coords";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT_DIR = process.env.EXTRACT_DIR ?? path.resolve(HERE, "../../handover-extract");

// load .env.local when run bare
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
if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY not set (load .env.local)");
assertSeedTarget(SUPABASE_URL);
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const REMOTE = process.argv.includes("--remote");
const limitArg = (flag: string, local: number) =>
  arg(flag) ? parseInt(arg(flag)!, 10) : REMOTE ? Infinity : local;
const STORIES_LIMIT = limitArg("--stories-limit", 150);
// Local runs seed a working subset, not the whole export — enough to exercise
// every surface (all 10 industries represented, both upcoming events, member
// news) without uploading ~800 media files. --remote lifts all four.
const MEMBERS_LIMIT = limitArg("--members-limit", 40);
const VIDEOS_LIMIT = limitArg("--videos-limit", 60);
const EVENTS_LIMIT = limitArg("--events-limit", 25);
const SKIP_MEDIA = process.argv.includes("--skip-media");
// --no-adverts: leave the advert inventory empty, to check the unsold state
const NO_ADVERTS = process.argv.includes("--no-adverts");
// --adverts-only: add sample adverts to an already-seeded DB without a reset
const ADVERTS_ONLY = process.argv.includes("--adverts-only");
// --media-only: (re)upload referenced media without touching any table — for
// backfilling after a failed/skipped upload pass on an already-seeded DB
const MEDIA_ONLY = process.argv.includes("--media-only");
// --pages-only: upsert static pages into an already-seeded DB, nothing else —
// safe on a populated target because static_pages upserts on slug
const PAGES_ONLY = process.argv.includes("--pages-only");

const seed = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(EXTRACT_DIR, "seed", name), "utf8"));

/**
 * The raw export, for the two member taxonomies the shaping step drops.
 * `members.seed.json` keeps only the Services slugs (as `category_slugs`) and
 * discards `sector` entirely, but we need both: Services populate the services
 * tables, and `sector` populates member_membership_types. Raw `wp_id` and
 * shaped `wp_member_id` are the same id space.
 */
const rawJson = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(path.join(EXTRACT_DIR, "json", name), "utf8"));

type WpTerm = { name: string; slug: string };
type RawMember = { wp_id: number; services?: WpTerm[]; sector?: WpTerm[] };


/** Same shape as scripts/seed.ts and the videos.slug backfill migration. */
const slugify = (s: string) =>
  s.toLowerCase().replace(/&[a-z0-9#]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

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
  // Seeded bookings are admin-sold and already approved: without a status they
  // would take the 'draft' default and render nothing.
  const booked = { status: "live", source: "admin", approved_at: today.toISOString(), went_live_at: monthsAgo.toISOString() };

  for (let i = 0; i < banners.length; i++) {
    const m = banners[i];
    const name = String(m.name);
    const [dPath, mPath] = await Promise.all([
      putSvg(`panels/panel-${i}-wide.svg`, svgBanner(name, 1280, 170, palette[i], { sample: true })),
      putSvg(`panels/panel-${i}-narrow.svg`, svgBanner(name, 370, 280, palette[i], { sample: true })),
    ]);
    const { data: ad, error: adErr } = await db
      .from("adverts")
      .insert({ member_id: memberId(m.wp_member_id), name: `${name} banner`, desktop_path: dPath, mobile_path: mPath, format: "banner" })
      .select("id").single();
    if (adErr) throw adErr;
    // last two expire within the week, so the console's expiry view has something to show
    await db.from("advert_bookings").insert({
      advert_id: ad!.id,
      ...booked,
      starts_on: iso(monthsAgo),
      ends_on: i < 6 ? iso(monthsAhead) : iso(new Date(today.getTime() + 5 * 864e5)),
    });
  }

  for (let i = 0; i < logos.length; i++) {
    const m = logos[i];
    const name = String(m.name);
    const p = await putSvg(`panels/mark-${i}.svg`, svgBanner(name.split(" ")[0], 240, 120, palette[(i + 3) % 8], { sample: true }));
    const { data: ad, error: adErr } = await db
      .from("adverts")
      .insert({ member_id: memberId(m.wp_member_id), name: `${name} supplier logo`, desktop_path: p, mobile_path: p, format: "supplier_logo" })
      .select("id").single();
    if (adErr) throw adErr;
    await db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
  }

  // Rate card (A2.7): sample rates so this seed path also has priced
  // products, not just the synthetic scripts/seed.ts.
  await db.from("advert_products").insert([
    { short_name: "Homepage banner", format: "banner", cap: 3, rate_pennies: 65000 },
    { short_name: "Skyscraper", format: "skyscraper", cap: 3, rate_pennies: 55000 },
    { short_name: "MPU box", format: "mpu", cap: 3, rate_pennies: 45000 },
    { short_name: "In-feed card", format: "in_feed", cap: 3, rate_pennies: 40000 },
    { short_name: "Supplier logo", format: "supplier_logo", cap: 8, rate_pennies: 10000 },
    { short_name: "Newsletter banner", format: "newsletter_banner", cap: 3, rate_pennies: 35000 },
    { short_name: "Association logo", format: "association_logo", cap: 3, rate_pennies: 15000 },
  ]);
}

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * `supabase db reset` clears Postgres (including storage.objects) but never
 * touches the Storage volume's files on disk — without this, every reseed
 * leaves the previous run's blobs behind and the local volume only grows.
 */
async function emptyBucket(prefix = "") {
  const { data, error } = await db.storage.from("media").list(prefix, { limit: 1000 });
  if (error) throw error;
  const files: string[] = [];
  for (const entry of data ?? []) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) await emptyBucket(full);
    else files.push(full);
  }
  for (const batch of chunk(files, 100)) {
    const { error: rmErr } = await db.storage.from("media").remove(batch);
    if (rmErr) throw rmErr;
  }
}

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
  // Invoices are private: served via signed URLs only (lib/invoice-pdf.ts).
  await db.storage.createBucket("invoices", { public: false }).catch(() => {});

  type Cat = { kind: string; slug: string; name: string };
  type MemberRow = Record<string, unknown> & { wp_member_id: number; slug: string; category_slugs: string[] };
  type StoryRow = Record<string, unknown> & { wp_member_id: number | null; slug: string; category_slugs: string[]; cover_path: string | null };
  type Manifest = { source: string; storage_path: string; used_by: string }[];

  const [catRows, memberRowsAll, storyRowsAll, videoRowsAll, eventRowsAll, pageRows, manifest, rawMembers] =
    await Promise.all([
      seed<Cat[]>("categories.seed.json"),
      seed<MemberRow[]>("members.seed.json"),
      seed<StoryRow[]>("stories.seed.json"),
      seed<Record<string, unknown>[]>("videos.seed.json"),
      seed<Record<string, unknown>[]>("events.seed.json"),
      seed<{ slug: string; title: string; body: string }[]>("static_pages.seed.json"),
      seed<Manifest>("media-manifest.json"),
      rawJson<RawMember[]>("members.json"),
    ]);

  // The two taxonomies the shaped seed drops, keyed by the id both files share.
  const rawById = new Map(rawMembers.map((m) => [m.wp_id, m]));
  // Deduped: the join tables key on (member_id, term_id), so a repeated tag in
  // a future re-export would abort the whole seed on a PK violation.
  const servicesOf = (wp: number) => [...new Set((rawById.get(wp)?.services ?? []).map((s) => s.slug))];
  const sectorsOf = (wp: number) => [...new Set((rawById.get(wp)?.sector ?? []).map((s) => s.slug))];
  // Derived, NOT from the export — see scripts/lib/industry-map.ts and the
  // validation item in docs/GO-LIVE.md.
  const industryOf = (row: MemberRow) => industryForServices(servicesOf(row.wp_member_id));

  // Content per member, so the subset keeps the members who actually have
  // stories/videos — otherwise /news's member rail and the member pages'
  // story lists come out empty (only 34 of the 123 members own any content).
  const contentPerMember = new Map<number, number>();
  for (const r of [...storyRowsAll, ...videoRowsAll] as { wp_member_id?: number | null }[]) {
    if (r.wp_member_id) contentPerMember.set(r.wp_member_id, (contentPerMember.get(r.wp_member_id) ?? 0) + 1);
  }
  const memberRows = selectMembers(memberRowsAll, industryOf, MEMBERS_LIMIT, (m) => contentPerMember.get(m.wp_member_id) ?? 0);
  const keptWpIds = new Set(memberRows.map((m) => m.wp_member_id));
  if (memberRows.length < memberRowsAll.length)
    console.log(`— members limited to ${memberRows.length} of ${memberRowsAll.length} (spread across industries)`);

  // Content follows the members, so member-attributed stories/videos actually
  // exist in the subset — picking them independently is what left /news's
  // "Member news" rail empty.
  const takeForMembers = <T extends { wp_member_id?: number | null }>(rows: T[], limit: number) => {
    if (rows.length <= limit) return rows;
    const mine = rows.filter((r) => r.wp_member_id && keptWpIds.has(r.wp_member_id));
    const rest = rows.filter((r) => !(r.wp_member_id && keptWpIds.has(r.wp_member_id)));
    return [...mine, ...rest.slice(0, Math.max(0, limit - mine.length))].slice(0, limit);
  };

  const storyRows = takeForMembers(storyRowsAll, STORIES_LIMIT);
  if (storyRows.length < storyRowsAll.length)
    console.log(`— stories limited to ${storyRows.length} of ${storyRowsAll.length} (member stories first, then newest)`);

  const videoRows = takeForMembers(videoRowsAll as (Record<string, unknown> & { wp_member_id?: number | null })[], VIDEOS_LIMIT);
  if (videoRows.length < videoRowsAll.length)
    console.log(`— videos limited to ${videoRows.length} of ${videoRowsAll.length} (member videos first, then newest)`);

  // Events carry no member link, and only a couple are ever in the future —
  // keep every upcoming one or the events page loses its whole upcoming list,
  // then backfill with the most recent past events.
  const today = new Date().toISOString().slice(0, 10);
  const endsOn = (e: Record<string, unknown>) => String(e.ends_on ?? e.starts_on ?? "");
  const upcoming = eventRowsAll.filter((e) => endsOn(e) >= today);
  const past = eventRowsAll.filter((e) => endsOn(e) < today).sort((a, b) => endsOn(b).localeCompare(endsOn(a)));
  const eventRows =
    eventRowsAll.length <= EVENTS_LIMIT
      ? eventRowsAll
      : [...upcoming, ...past.slice(0, Math.max(0, EVENTS_LIMIT - upcoming.length))];
  if (eventRows.length < eventRowsAll.length)
    console.log(`— events limited to ${eventRows.length} of ${eventRowsAll.length} (${upcoming.length} upcoming kept)`);

  // Authored rows (content the extract can't produce) win over extract rows on slug.
  // PostgREST bulk upserts need uniform keys across rows, so default the
  // per-row `collapsible` flag (only some authored rows set it) explicitly.
  const authoredSlugs = new Set(AUTHORED_STATIC_PAGES.map((p) => p.slug));
  const allPageRows = [...pageRows.filter((p) => !authoredSlugs.has(p.slug)), ...AUTHORED_STATIC_PAGES]
    .map((p) => ({ collapsible: false, ...p }));

  if (PAGES_ONLY) {
    console.log(`— static pages only (${allPageRows.length})`);
    const { error } = await db.from("static_pages").upsert(allPageRows, { onConflict: "slug" });
    if (error) throw error;
    return;
  }

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

  console.log("— media: clearing stale files from previous seeds");
  await emptyBucket();

  // `categories` kind='member' is the INDUSTRY list (one per member), not the
  // Services vocabulary. The extract's member-kind rows are the 69 WP Services
  // terms — seeding those here is what put 69 service names in the industry
  // bar. They now go to the `services` tables instead, and industries come from
  // the canonical list shared with scripts/seed.ts.
  const storyCatRows = catRows.filter((c) => c.kind === "story");
  const catRowsToSeed = [...storyCatRows, ...INDUSTRY_ROWS];
  console.log(`— categories (${storyCatRows.length} story topics + ${INDUSTRY_ROWS.length} industries)`);
  const { data: cats, error: catErr } = await db.from("categories").upsert(catRowsToSeed, { onConflict: "kind,slug" }).select();
  if (catErr) throw catErr;
  const catId = (kind: string, slug: string) => cats!.find((c) => c.kind === kind && c.slug === slug)?.id ?? null;

  console.log(`— services (${catRows.length - storyCatRows.length} terms, the real /find-a-member vocabulary)`);
  const serviceRows = catRows.filter((c) => c.kind === "member").map(({ slug, name }) => ({ slug, name }));
  const { data: serviceCats, error: svcErr } = await db.from("services").upsert(serviceRows, { onConflict: "slug" }).select();
  if (svcErr) throw svcErr;
  const serviceId = new Map(serviceCats!.map((s) => [s.slug, s.id]));

  console.log(`— members (${memberRows.length})`);
  const wpToUuid = new Map<number, string>();
  for (const rows of chunk(memberRows, 100)) {
    // testimonials dropped product-wide (migration 20260902000003) — the extract's
    // rows still carry the field, so it must be excluded rather than spread in.
    // category_slugs are the member's SERVICES (they seed member_services below);
    // category_id is their single derived industry.
    const insert = rows.map(({ wp_member_id, category_slugs, testimonials, ...r }) => {
      const industry = industryForServices(servicesOf(wp_member_id));
      return { ...r, category_id: industry ? catId("member", industrySlug(industry)) : null };
    });
    const { data, error } = await db.from("members").insert(insert).select("id, slug");
    if (error) throw error;
    for (const m of data!) wpToUuid.set(rows.find((r) => r.slug === m.slug)!.wp_member_id, m.id);
  }
  const memberId = (wp: number | null | undefined) => (wp ? wpToUuid.get(wp) ?? null : null);

  // Services per member — the real multi-value taxonomy, previously collapsed
  // to "first one wins" on members.category_id and otherwise discarded.
  const memberServiceLinks = memberRows.flatMap((m) => {
    const id = memberId(m.wp_member_id);
    if (!id) return [];
    return servicesOf(m.wp_member_id).flatMap((slug) => {
      const service_id = serviceId.get(slug);
      return service_id ? [{ member_id: id, service_id }] : [];
    });
  });
  if (memberServiceLinks.length) {
    const { error } = await db.from("member_services").insert(memberServiceLinks);
    if (error) throw error;
  }

  // Membership types from the legacy WP "sector" field — neither seed populated
  // these before, so the directory's membership filter matched nothing for
  // every member. Only 2 of the 4 sector terms have an equivalent in the
  // 5-item list (docs/ask-jas.md:23 flags the mismatch); the rest stay
  // unlinked rather than being force-fitted.
  const { data: mTypes, error: mtErr } = await db.from("membership_types").select("id, slug");
  if (mtErr) throw mtErr;
  const membershipTypeId = new Map(mTypes!.map((t) => [t.slug, t.id]));
  const memberTypeLinks = memberRows.flatMap((m) => {
    const id = memberId(m.wp_member_id);
    if (!id) return [];
    return sectorsOf(m.wp_member_id).flatMap((slug) => {
      const membership_type_id = membershipTypeId.get(slug);
      return membership_type_id ? [{ member_id: id, membership_type_id }] : [];
    });
  });
  if (memberTypeLinks.length) {
    const { error } = await db.from("member_membership_types").insert(memberTypeLinks);
    if (error) throw error;
  }
  console.log(`— member taxonomies: ${memberServiceLinks.length} service links, ${memberTypeLinks.length} membership-type links`);

  if (!NO_ADVERTS) await seedAdverts(memberRows, memberId);

  console.log("— auth users (1 admin, media co member, 3 member logins on real members)");
  const mkUser = async (email: string, role: Role, member_id: string | null, display_name: string) => {
    const { data, error } = await db.auth.admin.createUser({ email, password: "local-dev-password", email_confirm: true });
    if (error) throw error;
    await db.from("profiles").insert({ user_id: data.user.id, role, member_id, display_name });
  };
  await mkUser("jas@smi.local", "admin", null, "Jas");

  // Media Co isn't an SMI trade member — a member row with status "draft"
  // (the default) gives it a member_id for the dashboard's draft-only story
  // flow without it ever surfacing in the public directory/search/sitemap,
  // which only ever query status "active"/"grace".
  const { data: mediaMember, error: mediaMemberErr } = await db
    .from("members")
    .insert({ slug: "media-co", name: "Media Co", contact_email: "media@smi.local" })
    .select("id")
    .single();
  if (mediaMemberErr) throw mediaMemberErr;
  await mkUser("media@smi.local", "member", mediaMember.id, "Media Co");
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
  // videos.slug is unique and not null, and the export carries no slug — the old
  // site addressed videos by WP post id. Derive it from the title, the same
  // shape the backfill migration uses, and de-duplicate across the WHOLE set
  // rather than per chunk: repeated titles are real ("What's your angle" runs as
  // a series), and a per-chunk counter would let two chunks both emit "-2".
  const usedVideoSlugs = new Set<string>();
  const videoSlug = (title: string) => {
    const base = slugify(title) || "video";
    let slug = base;
    for (let n = 2; usedVideoSlugs.has(slug); n++) slug = `${base}-${n}`;
    usedVideoSlugs.add(slug);
    return slug;
  };
  for (const rows of chunk(videoRows, 200)) {
    const insert = rows.map(({ wp_member_id, ...r }) => ({
      ...r,
      slug: videoSlug(r.title as string),
      member_id: memberId(wp_member_id as number | null),
    }));
    const { error } = await db.from("videos").insert(insert);
    if (error) throw error;
  }
  // Attach authored coordinates so the /event map has pins — the export has
  // none and the app only geocodes on save (see lib/event-coords.ts).
  const eventInsert = eventRows.map((e) => {
    const coords = AUTHORED_EVENT_COORDS[String(e.slug)];
    return coords ? { ...e, lat: coords.lat, lng: coords.lng } : e;
  });
  const withCoords = eventInsert.filter((e) => "lat" in e && e.lat != null).length;
  console.log(`— events: ${withCoords} of ${eventInsert.length} have coordinates (map pins)`);
  const { error: evErr } = await db.from("events").insert(eventInsert);
  if (evErr) throw evErr;

  console.log(`— static pages (${allPageRows.length})`);
  const { error: pgErr } = await db.from("static_pages").upsert(allPageRows, { onConflict: "slug" });
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
    // Grid-design inventory (migration 20260825000001 adds the formats)
    { key: "home_sky", label: "Homepage skyscraper", cap: 3 },
    { key: "home_mpu_1", label: "Homepage box 1", cap: 3 },
    { key: "home_mpu_2", label: "Homepage box 2", cap: 3 },
    { key: "home_infeed", label: "Homepage in-feed", cap: 3 },
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

  // Real featured machine (fix list): the WP export has no machine/equipment
  // content type at all — "equipment suppliers" are just members tagged with a
  // sector — so this can't come from the extract like everything else above.
  // Hand-authored from the live page (sheetmetalindustries.com/31770-2/) against
  // a real seeded member, not faker.js text (contrast scripts/seed.ts's synthetic one).
  console.log("— featured machine (real: Salvagnini S1)");
  const { data: salvagnini } = await db.from("members").select("id").eq("slug", "salvagnini-uk-ireland").maybeSingle();
  if (salvagnini) {
    const imageBody = await readFile(path.join(HERE, "seed-assets", "featured-machine-salvagnini-s1.jpg"));
    const { error: imgErr } = await db.storage
      .from("media")
      .upload("machines/salvagnini-s1.jpg", imageBody, { contentType: "image/jpeg", upsert: true });
    if (imgErr) throw imgErr;
    const { data: fm, error: fmErr } = await db.from("featured_machines").insert({
      member_id: salvagnini.id,
      name: "S1 Laser Punching Machine",
      description:
        "<p>S1 is a punch-laser combi machine, a true work center that punches, forms, taps, and cuts parts.</p>" +
        "<p>The S1 <strong>maximizes process efficiency</strong>: all the punching, forming and separation operations are automatic, done by a single system that eliminates semi-finished parts, does not require manual intervention and assures extreme repeatability.</p>" +
        "<p>Store-towers and automatic loading/unloading devices <strong>increase the autonomy of the system</strong>, and integrated adaptive technologies <strong>make the system intelligent</strong>, automatically adapting to variation and guaranteeing high machining quality.</p>",
      image_path: "machines/salvagnini-s1.jpg",
      external_url: "https://www.salvagninigroup.com/en-INT/products/punching-machines/S1",
    }).select("id").single();
    if (fmErr) throw fmErr;
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const { error: plErr } = await db.from("placements").insert({
      kind: "featured_machine",
      featured_machine_id: fm.id,
      member_id: salvagnini.id,
      starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      ends_on: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    });
    if (plErr) throw plErr;
  } else {
    console.warn("— featured machine: salvagnini-uk-ireland not found in this seed run, skipped");
  }

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
