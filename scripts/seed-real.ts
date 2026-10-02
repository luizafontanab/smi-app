/**
 * Seed local Supabase with REAL content extracted from the old WordPress site
 * (see /Users/zafontana/SMI/handover-extract — run its extract + shape-seed
 * scripts first). Alternative to seed.ts: real members/stories/video/event
 * plus the minimal infra rows (auth users, advert slots, settings, layouts) and
 * SAMPLE-stamped adverts so the slots have something to rotate (--no-adverts
 * skips them). On a LOCAL run it also adds a few synthetic upcoming events and
 * sent newsletter issues (--no-demo-rows skips them, --remote refuses them):
 * the extract has no newsletters at all and its real events have mostly gone
 * past, so without these two sections of the grid homepage render nothing.
 * Other synthetic operational data (analytics, contacts) is still NOT seeded —
 * run seed.ts instead when demoing those consoles.
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
 *                          — local only: SAMPLE art names real companies
 *        [--legacy-adverts-only] import the old site's real adverts into an
 *                          already-seeded DB, each in-date run awaiting approval —
 *                          idempotent, safe on production
 *        [--demo-rows]     add the synthetic upcoming events, sent newsletter
 *                          issues and console inbox rows to an already-seeded
 *                          DB, nothing else — idempotent, needs no extract,
 *                          local targets only
 *        [--no-demo-rows]  leave them out of a full run
 *        [--pages-only]    upsert static pages into an already-seeded DB, nothing else
 *        [--taxonomies-only] repair industries/services/membership-type links on an
 *                          already-seeded DB — idempotent, writes no content or media
 *        [--dry-run]       with --taxonomies-only: print the changes, write nothing
 *        [--remote]        allow a non-localhost target; also lifts the story cap
 */
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "@/lib/auth";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { svgBanner } from "./lib/placeholder-art";
import { AUTHORED_STATIC_PAGES } from "./lib/static-page-content";
import { assertSeedTarget } from "./lib/target-guard";
import { listAllObjects } from "./lib/storage-list";
import { INDUSTRY_ROWS, industrySlug } from "./lib/industries";
import { industryForServices } from "./lib/industry-map";
import { selectMembers } from "./lib/select-members";
import { AUTHORED_EVENT_COORDS } from "./lib/event-coords";
import { planLegacyAdverts, type LegacyAdvertRow } from "./lib/legacy-adverts";

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
// Say where this is writing, on every run rather than only --taxonomies-only.
// NEXT_PUBLIC_SUPABASE_URL defaults to localhost above, so a missing or misnamed
// variable in .env.production.local seeds the LOCAL database while a `seed:prod`
// run appears to succeed — and --remote means assertSeedTarget passes it either
// way. One line makes that visible instead of silent.
console.log(`— target: ${SUPABASE_URL}${process.argv.includes("--remote") ? " (--remote)" : ""}`);
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
// --force-media: re-upload every referenced file even if the path already exists
// in the bucket. Needed only when a file's contents changed but its path didn't.
const FORCE_MEDIA = process.argv.includes("--force-media");
// --pages-only: upsert static pages into an already-seeded DB, nothing else —
// safe on a populated target because static_pages upserts on slug
const PAGES_ONLY = process.argv.includes("--pages-only");
// --taxonomies-only: repair the three member taxonomies on an already-seeded DB
// without touching content or media. Written for production, which was seeded
// before the taxonomy split and so has no services/member_services rows and no
// real industry assignment. Every write is an upsert, so it is re-runnable.
const TAXONOMIES_ONLY = process.argv.includes("--taxonomies-only");
// --events-only: repair fields on events that already exist, matched by slug.
// Needed because the full seed plain-inserts and expects a fresh database, so a
// field added to the shaper after an import can't otherwise reach a live target.
const EVENTS_ONLY = process.argv.includes("--events-only");
// --legacy-adverts-only: import the REAL adverts from the old site (legacy
// slots A banners and D supplier logos) into an already-seeded DB. Unlike
// --adverts-only, which makes SAMPLE artwork, this is the live inventory the
// old site was running. Idempotent — matched on artwork path — so re-runs add
// nothing. Nothing it creates renders until Jas approves it.
const LEGACY_ADVERTS_ONLY = process.argv.includes("--legacy-adverts-only");
// --demo-rows: add the synthetic upcoming events and sent newsletter issues to
// an already-seeded DB, nothing else. Also part of a normal local run;
// --no-demo-rows opts out, and --remote refuses them outright (see
// seedDemoRows). Idempotent, so it is safe to re-run on a populated local DB.
const DEMO_ROWS_ONLY = process.argv.includes("--demo-rows");
const NO_DEMO_ROWS = process.argv.includes("--no-demo-rows");
// --dry-run: print what --taxonomies-only would change and write nothing.
const DRY_RUN = process.argv.includes("--dry-run");

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
  // A SAMPLE banner on the live site tells every reader that a real company
  // is advertising when it has bought nothing — and the 24 Sep production seed
  // put exactly that there, because this ran on every full run, --remote
  // included. The caller now skips it on --remote; this repeats the guard
  // for the same reason seedDemoRows does.
  if (REMOTE) throw new Error("seedAdverts makes SAMPLE adverts and must never run against a remote target");
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
  // 830×170, for the grid homepage's narrow column. Its own format, so its own
  // rotation pool — this artwork must never be dealt into a full-width slot
  // (migration 20260917000001).
  const narrowBanners = adMembers.slice(13, 15);
  console.log(`— sample adverts (${banners.length} banners, ${narrowBanners.length} narrow banners, ${logos.length} supplier logos)`);
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

  for (let i = 0; i < narrowBanners.length; i++) {
    const m = narrowBanners[i];
    const name = String(m.name);
    const [dPath, mPath] = await Promise.all([
      putSvg(`panels/narrow-${i}-wide.svg`, svgBanner(name, 830, 170, palette[(i + 2) % 8], { sample: true })),
      putSvg(`panels/narrow-${i}-mobile.svg`, svgBanner(name, 370, 280, palette[(i + 2) % 8], { sample: true })),
    ]);
    const { data: ad, error: adErr } = await db
      .from("adverts")
      .insert({ member_id: memberId(m.wp_member_id), name: `${name} narrow banner`, desktop_path: dPath, mobile_path: mPath, format: "banner_narrow" })
      .select("id").single();
    if (adErr) throw adErr;
    await db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
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
    { short_name: "Homepage banner (narrow)", format: "banner_narrow", cap: 3, rate_pennies: 65000 },
    { short_name: "Skyscraper", format: "skyscraper", cap: 3, rate_pennies: 55000 },
    { short_name: "MPU box", format: "mpu", cap: 3, rate_pennies: 45000 },
    { short_name: "In-feed card", format: "in_feed", cap: 3, rate_pennies: 40000 },
    { short_name: "Supplier logo", format: "supplier_logo", cap: 8, rate_pennies: 10000 },
    { short_name: "Newsletter banner", format: "newsletter_banner", cap: 3, rate_pennies: 35000 },
    { short_name: "Association logo", format: "association_logo", cap: 3, rate_pennies: 15000 },
  ]);
}

/**
 * Insert members with everything the full seed gives a member: derived
 * industry, Services links and membership types. Shared by the full run and by
 * the local advertiser top-up in --legacy-adverts-only, so a member added
 * later is not a thinner row than one added by a fresh seed.
 * Returns wp_member_id → uuid for the rows inserted.
 */
async function insertMembers(
  memberRows: (Record<string, unknown> & { wp_member_id: number; slug: string })[],
  deps: {
    industryId: (slug: string) => string | null;
    serviceId: Map<string, string>;
    servicesOf: (wp: number) => string[];
    sectorsOf: (wp: number) => string[];
  },
): Promise<Map<number, string>> {
  const { industryId, serviceId, servicesOf, sectorsOf } = deps;
  const wpToUuid = new Map<number, string>();
  for (const rows of chunk(memberRows, 100)) {
    // testimonials dropped product-wide (migration 20260902000003) — the extract's
    // rows still carry the field, so it must be excluded rather than spread in.
    // category_slugs are the member's SERVICES (they seed member_services below);
    // industry_id is their single derived industry.
    const insert = rows.map(({ wp_member_id, category_slugs, testimonials, ...r }) => {
      const industry = industryForServices(servicesOf(wp_member_id));
      return { ...r, industry_id: industry ? industryId(industrySlug(industry)) : null };
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
  return wpToUuid;
}

/**
 * The old site's real adverts — see scripts/lib/legacy-adverts.ts for every
 * decision this makes. Members are matched by slug, as in --taxonomies-only,
 * because `members` carries no wp_member_id.
 */
async function importLegacyAdverts(
  memberRows: { wp_member_id: number; slug: string }[],
  rows: LegacyAdvertRow[],
  manifest: { source: string; storage_path: string }[],
) {
  const { data: members, error: mErr } = await db.from("members").select("id, slug");
  if (mErr) throw mErr;
  const idBySlug = new Map(members!.map((m) => [m.slug, m.id]));
  const slugByWp = new Map(memberRows.map((m) => [m.wp_member_id, m.slug]));

  const { data: existing, error: eErr } = await db
    .from("adverts").select("desktop_path").in("desktop_path", rows.map((r) => r.desktop_path));
  if (eErr) throw eErr;

  const now = new Date();
  const plan = planLegacyAdverts(rows, {
    today: now.toISOString().slice(0, 10),
    now: now.toISOString(),
    memberId: (wp) => idBySlug.get(slugByWp.get(wp) ?? "") ?? null,
    existingDesktopPaths: new Set(existing!.map((a) => a.desktop_path)),
  });
  const pending = plan.inserts.filter((p) => p.booking).length;
  console.log(
    `— legacy adverts: ${plan.inserts.length} to import (${pending} awaiting approval, ` +
      `${plan.inserts.length - pending} lapsed, artwork only), ${plan.present.length} already present` +
      (plan.noMember.length ? `, ${plan.noMember.length} skipped — member not on target: ${plan.noMember.join(", ")}` : ""),
  );
  if (!plan.inserts.length) return;

  // Artwork first, so no advert row ever points at a file that isn't there.
  if (!SKIP_MEDIA) {
    await uploadMedia([], [], [], [], manifest, plan.inserts.flatMap((p) => [p.advert.desktop_path, p.advert.mobile_path]));
  }
  for (const p of plan.inserts) {
    const { data: ad, error } = await db.from("adverts").insert(p.advert).select("id").single();
    if (error) throw new Error(`advert ${p.legacy_key}: ${error.message}`);
    if (p.booking) {
      const { error: bErr } = await db.from("advert_bookings").insert({ advert_id: ad!.id, ...p.booking });
      // Surface it rather than leave an advert with no booking silently
      // looking like a lapsed one.
      if (bErr) throw new Error(`booking ${p.legacy_key} (advert ${ad!.id} was created): ${bErr.message}`);
    }
  }
}

/**
 * Repair the three member taxonomies on a database that already holds members
 * — production, which was seeded before the taxonomy split (20260909000001,
 * 20260909000002) and so has an empty `services`, an empty `member_services`,
 * an empty `member_membership_types`, and no real industry assignment.
 *
 * Everything here is an upsert keyed on a natural key, so the pass is
 * re-runnable and safe to interrupt. It writes no content and touches no media.
 *
 * Members are matched to the extract by SLUG: `members` carries no
 * wp_member_id, and slug is the only stable identifier both sides share.
 */
/**
 * Synthetic upcoming events and sent newsletter issues — the two things the
 * real extract cannot supply in a useful quantity, and the reason two sections
 * of the grid homepage render nothing on a freshly seeded machine.
 *
 * Why this is needed at all:
 *   · EVENTS — the extract's events are real, and real events go past. Only
 *     one is still in the future, so "Upcoming events" (which takes events[1]
 *     onward, events[0] being the fold's placement card) has nothing to show.
 *     Three more, dated forward from today, so the row fills whenever it runs.
 *   · NEWSLETTERS — the extract has none at all. The WordPress site kept its
 *     issues in Mailchimp, not in the CMS, so there is nothing to extract.
 *
 * Same principle as the SAMPLE adverts above: seed enough that every surface
 * has something in it, and be explicit that it is not real. Covers are
 * borrowed from real events already in storage, so this uploads nothing.
 *
 * NEVER on --remote. A fabricated trade event on the live site is not a
 * placeholder, it is misinformation — someone could plan a trip around it.
 * The caller enforces this; the guard is repeated here because the cost of
 * getting it wrong is a real person driving to Birmingham.
 *
 * Re-runnable: events upsert on their unique slug, issues on their unique
 * number, and each issue's items are cleared before they are rewritten.
 */
async function seedDemoRows(): Promise<void> {
  if (REMOTE) throw new Error("seedDemoRows must never run against a remote target");
  // One prefix, used both to name these rows and to exclude them from the
  // cover lookup below. They are also the handle for removing them by hand.
  const DEMO_SLUG_PREFIX = "smi-demo-";

  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // Real covers, so the cards carry pictures rather than the empty-state cog.
  // Newest first: the most recent events are the ones whose media is certain
  // to have been uploaded by this same run.
  //
  // Excluding this function's own rows is what makes a re-run stable. Without
  // it the second run reads back the covers it wrote on the first — the demo
  // events are dated furthest into the future, so they ARE the newest three —
  // and the row ends up showing the same picture two or three times.
  const { data: covered } = await db
    .from("events")
    .select("cover_path")
    .not("cover_path", "is", null)
    .not("slug", "like", `${DEMO_SLUG_PREFIX}%`)
    .order("starts_on", { ascending: false })
    .limit(3);
  const cover = (i: number) => covered?.[i % Math.max(covered.length, 1)]?.cover_path ?? null;

  const events = [
    { slug: `${DEMO_SLUG_PREFIX}fabrication-north`, title: "Fabrication North Open Day", location: "Leeds, LS11 5BD", lat: 53.7797, lng: -1.5492, starts_on: day(26) },
    { slug: `${DEMO_SLUG_PREFIX}press-brake-live`, title: "Press Brake Technology Live", location: "Birmingham NEC, B40 1NT", lat: 52.4506, lng: -1.7180, starts_on: day(54) },
    { slug: `${DEMO_SLUG_PREFIX}welding-skills`, title: "Welding Skills Showcase", location: "Manchester, M17 1HH", lat: 53.4670, lng: -2.3200, starts_on: day(88) },
  ].map((e, i) => ({
    ...e,
    status: "published",
    cover_path: cover(i),
    description: "Sample event seeded for local development — not a real date in the trade calendar.",
  }));

  const { error: evErr } = await db.from("events").upsert(events, { onConflict: "slug" });
  if (evErr) throw evErr;

  // Issues need stories to list, or /newsletters/[slug] renders an empty page.
  const { data: pubStories } = await db.from("stories").select("id").eq("status", "published").limit(24);
  const stories = pubStories ?? [];

  const monthsAgo = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n, 3);
    return d.toISOString();
  };
  const monthName = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n, 3);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };

  // Descending numbers so the newest issue is the highest, as a real archive
  // would be — sentNewsletters() orders on number, not on sent_at.
  const issues = [0, 1, 2].map((n) => ({
    number: 47 - n,
    subject: `SMI Monthly — ${monthName(n + 1)}`,
    status: "sent",
    web_slug: `smi-monthly-${47 - n}`,
    sent_at: monthsAgo(n + 1),
    intro: "Sample issue seeded for local development: the month's news, new machinery and the events worth your time.",
  }));

  const { data: written, error: nlErr } = await db
    .from("newsletter_issues")
    .upsert(issues, { onConflict: "number" })
    .select("id, number");
  if (nlErr) throw nlErr;

  // newsletter_items has no natural key to upsert on, so a re-run replaces
  // each issue's list rather than doubling it.
  for (const issue of written ?? []) {
    await db.from("newsletter_items").delete().eq("issue_id", issue.id);
    const slice = stories.slice((47 - issue.number) * 8, (47 - issue.number) * 8 + 8);
    if (slice.length === 0) continue;
    const { error } = await db
      .from("newsletter_items")
      .insert(slice.map((s, i) => ({ issue_id: issue.id, story_id: s.id, position: i })));
    if (error) throw error;
  }

  /*
   * Top the Featured Member carousel up to its cap. The seed sells three, and
   * the homepage box shows three at a time — so at three it never rotates and
   * the carousel looks like the static list it used to be. Filling the cap is
   * the only way to see the thing actually work locally.
   *
   * Converges rather than inserts blindly: placements has no natural unique
   * key, so a re-run counts what is already live and adds only the shortfall.
   */
  const { count: liveFeatured } = await db
    .from("placements")
    .select("id", { count: "exact", head: true })
    .eq("kind", "featured_member")
    .lte("starts_on", day(0))
    .gte("ends_on", day(0));

  const shortfall = FEATURED_SLOTS.cap - (liveFeatured ?? 0);
  if (shortfall > 0) {
    const { data: placed } = await db.from("placements").select("member_id").eq("kind", "featured_member");
    const taken = new Set((placed ?? []).map((p) => p.member_id).filter(Boolean));
    const { data: candidates } = await db
      .from("members")
      .select("id")
      .eq("status", "active")
      .not("logo_path", "is", null)
      .order("name");
    const fill = (candidates ?? []).filter((m) => !taken.has(m.id)).slice(0, shortfall);
    if (fill.length > 0) {
      const { error } = await db.from("placements").insert(
        fill.map((m) => ({ kind: "featured_member", member_id: m.id, starts_on: day(-5), ends_on: day(25) })),
      );
      if (error) throw error;
    }
    console.log(`— demo rows: +${fill.length} featured-member placements (now ${(liveFeatured ?? 0) + fill.length} of ${FEATURED_SLOTS.cap})`);
  }

  /*
   * Console inbox (fix-list 71). `/console/notifications` and the Command
   * Centre's Messages card are both empty on a real-content seed, because
   * nothing in the WordPress extract is an enquiry and no member has submitted
   * anything here — so the split between messages and notifications, which is
   * the whole point of the page, cannot be seen at all.
   *
   * Four rows, two of each category. The notifications carry real ids read back
   * from this same database, so their "Open it →" lands on a row that exists.
   *
   * Re-runnable: inbox_messages has no natural key to upsert on, so these are
   * tagged in `payload` and the tag is cleared before they are rewritten. The
   * tag is also the handle for removing them by hand.
   */
  const DEMO_INBOX_TAG = "smi-demo";
  await db.from("inbox_messages").delete().eq("payload->>demo", DEMO_INBOX_TAG);

  const { data: demoMembers } = await db
    .from("members").select("id, name").eq("status", "active").order("name").limit(2);
  const { data: demoStory } = await db.from("stories").select("id").order("created_at", { ascending: false }).limit(1);
  const { data: demoEvent } = await db.from("events").select("id").not("slug", "like", `${DEMO_SLUG_PREFIX}%`).limit(1);

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  // Uniform keys across rows: PostgREST rejects a bulk insert whose rows
  // disagree about which columns they carry.
  const inboxRow = (r: {
    category: string; kind: string; name: string; message: string; hours: number;
    read?: boolean; email?: string; memberId?: string | null; payload?: Record<string, string>;
  }) => ({
    category: r.category,
    kind: r.kind,
    name: r.name,
    email: r.email ?? "",
    message: r.message,
    read: r.read ?? false,
    created_at: hoursAgo(r.hours),
    replied_at: null,
    member_id: r.memberId ?? null,
    payload: { ...(r.payload ?? {}), demo: DEMO_INBOX_TAG },
  });

  const inboxRows = [
    inboxRow({
      category: "message", kind: "contact", hours: 3,
      name: "SAMPLE — Gareth Pryce", email: "sample-enquiry@example.invalid",
      message: "Sample enquiry seeded for local development.\n\nWe're after a supplier who can laser-cut 6mm stainless in batches of 200 — can you point me at anyone in South Wales?",
    }),
    inboxRow({
      category: "message", kind: "advertising", hours: 26,
      name: "SAMPLE — Hannah Okoro", email: "sample-advertising@example.invalid",
      message: "Sample enquiry seeded for local development. What does a homepage banner cost for a three-month run?",
    }),
    ...(demoMembers?.[0] ? [inboxRow({
      category: "notification", kind: "story_submitted", hours: 1,
      name: demoMembers[0].name, memberId: demoMembers[0].id,
      payload: demoStory?.[0] ? { story_id: demoStory[0].id } : {},
      message: "Submitted a story for approval. (Sample notification seeded for local development.)",
    })] : []),
    ...(demoMembers?.[1] ? [inboxRow({
      category: "notification", kind: "event_submitted", hours: 7,
      name: demoMembers[1].name, memberId: demoMembers[1].id,
      payload: demoEvent?.[0] ? { event_id: demoEvent[0].id } : {},
      message: "Submitted an event for approval. (Sample notification seeded for local development.)",
    })] : []),
  ];
  const { error: inboxErr } = await db.from("inbox_messages").insert(inboxRows);
  if (inboxErr) throw inboxErr;

  console.log(`— demo rows: ${events.length} upcoming events, ${issues.length} sent newsletter issues, ${inboxRows.length} console inbox rows (SAMPLE content, local only)`);
}

/**
 * Both directions of a slug reconciliation are always reported, but capped:
 * against a local subset these run to ~80 slugs each and would bury the numbers
 * that matter. Shared by the member and event backfills.
 */
const sample = (slugs: string[]) =>
  slugs.slice(0, 10).join(", ") + (slugs.length > 10 ? `, …and ${slugs.length - 10} more` : "");

/**
 * Repair fields on events that are already imported, matched by slug.
 *
 * The full seed uses plain inserts and expects a fresh database, so anything the
 * shaper learns to emit *after* an import has no route to a live target. That
 * happened twice on this migration: coordinates (present in the export all
 * along, dropped in shaping) and `type` (the legacy `event-type` terms, never
 * mapped). Both are now emitted, and this is how they land without a re-import.
 *
 * Only ever writes columns derived from the export, and only where the export
 * has a value — a null in the seed never clears something a person set in the
 * console. Idempotent: re-running changes nothing.
 */
async function backfillEvents(rows: Record<string, unknown>[]) {
  const say = (s: string) => console.log(`${DRY_RUN ? "[dry-run] " : ""}${s}`);
  type EventSeed = { slug: string; type: string | null; lat: number | null; lng: number | null };
  const eventRows = rows as unknown as EventSeed[];
  const { data: live, error } = await db.from("events").select("id, slug, type, lat, lng");
  if (error) throw error;

  const bySlug = new Map((live ?? []).map((e) => [e.slug, e]));
  const matched = eventRows.filter((e) => bySlug.has(e.slug));
  const missingFromTarget = eventRows.filter((e) => !bySlug.has(e.slug)).map((e) => e.slug);
  const unknownInTarget = (live ?? []).filter((e) => !eventRows.some((r) => r.slug === e.slug)).map((e) => e.slug);

  say(`— events: ${matched.length} of ${eventRows.length} extract rows matched by slug`);
  if (missingFromTarget.length) say(`  ⚠ in the extract but NOT in the target (${missingFromTarget.length}): ${sample(missingFromTarget)}`);
  if (unknownInTarget.length) say(`  ⚠ in the target but NOT in the extract (${unknownInTarget.length}, left untouched): ${sample(unknownInTarget)}`);

  let typed = 0, located = 0, unchanged = 0;
  for (const row of matched) {
    const current = bySlug.get(row.slug)!;
    const patch: Record<string, unknown> = {};
    if (row.type != null && current.type !== row.type) patch.type = row.type;
    if (row.lat != null && row.lng != null && (current.lat == null || current.lng == null)) {
      patch.lat = row.lat;
      patch.lng = row.lng;
    }
    if (!Object.keys(patch).length) {
      unchanged++;
      continue;
    }
    if ("type" in patch) typed++;
    if ("lat" in patch) located++;
    if (DRY_RUN) continue;
    const { error: upErr } = await db.from("events").update(patch).eq("id", current.id);
    if (upErr) throw upErr;
  }
  say(`— events updated: ${typed} type, ${located} coordinates (${unchanged} already correct)`);
}

async function backfillTaxonomies(
  memberRows: { wp_member_id: number; slug: string }[],
  catRows: { kind: string; slug: string; name: string }[],
  servicesOf: (wp: number) => string[],
  sectorsOf: (wp: number) => string[],
) {
  const say = (s: string) => console.log(`${DRY_RUN ? "[dry-run] " : ""}${s}`);
  say(`— taxonomies-only against ${SUPABASE_URL}`);

  // 1. Industries. The migration inserts these; upserting makes the script
  //    self-sufficient and re-asserts names if one was edited by hand.
  say(`— industries (${INDUSTRY_ROWS.length})`);
  if (!DRY_RUN) {
    const { error } = await db.from("industries").upsert(INDUSTRY_ROWS, { onConflict: "slug" });
    if (error) throw error;
  }
  const { data: inds, error: indErr } = await db.from("industries").select("id, slug");
  if (indErr) throw indErr;
  const industryId = new Map((inds ?? []).map((i) => [i.slug, i.id]));

  // 2. The Services vocabulary — the extract's member-kind category rows.
  const serviceRows = catRows.filter((c) => c.kind === "member").map(({ slug, name }) => ({ slug, name }));
  say(`— services (${serviceRows.length} terms)`);
  if (!DRY_RUN) {
    const { error } = await db.from("services").upsert(serviceRows, { onConflict: "slug" });
    if (error) throw error;
  }
  const { data: svcRows, error: svcErr } = await db.from("services").select("id, slug");
  if (svcErr) throw svcErr;
  const serviceId = new Map((svcRows ?? []).map((s) => [s.slug, s.id]));

  // 3. Match the target's members to the extract, by slug, and say loudly what
  //    did not match in EITHER direction rather than skipping quietly.
  const { data: liveMembers, error: memErr } = await db.from("members").select("id, slug");
  if (memErr) throw memErr;
  const idBySlug = new Map((liveMembers ?? []).map((m) => [m.slug, m.id]));
  const extractBySlug = new Map(memberRows.map((m) => [m.slug, m]));
  const matched = memberRows.filter((m) => idBySlug.has(m.slug));
  const missingFromTarget = memberRows.filter((m) => !idBySlug.has(m.slug)).map((m) => m.slug);
  const unknownInTarget = (liveMembers ?? []).filter((m) => !extractBySlug.has(m.slug)).map((m) => m.slug);
  say(`— members: ${matched.length} of ${memberRows.length} extract rows matched by slug`);
  if (missingFromTarget.length) say(`  ⚠ in the extract but NOT in the target (${missingFromTarget.length}): ${sample(missingFromTarget)}`);
  if (unknownInTarget.length) say(`  ⚠ in the target but NOT in the extract (${unknownInTarget.length}, left untouched): ${sample(unknownInTarget)}`);

  // 4. Each member's derived industry. DEV ASSUMPTION, not source data — see
  //    scripts/lib/industry-map.ts and docs/GO-LIVE.md 1.1.
  const assignments = matched.map((m) => {
    const industry = industryForServices(servicesOf(m.wp_member_id));
    return { id: idBySlug.get(m.slug)!, slug: m.slug, industry_id: industry ? industryId.get(industrySlug(industry)) ?? null : null };
  });
  const resolved = assignments.filter((a) => a.industry_id != null);
  say(`— member industries: ${resolved.length} resolved, ${assignments.length - resolved.length} left null`);
  if (!DRY_RUN) {
    for (const batch of chunk(assignments, 50)) {
      await Promise.all(
        batch.map(async (a) => {
          const { error } = await db.from("members").update({ industry_id: a.industry_id }).eq("id", a.id);
          if (error) throw error;
        }),
      );
    }
  }

  // 5. Services per member, and membership types from the legacy `sector`
  //    field. Only 2 of the 4 sector terms have an equivalent in the 5-item
  //    list (docs/ask-jas.md); the rest stay unlinked rather than force-fitted.
  const { data: mTypes, error: mtErr } = await db.from("membership_types").select("id, slug");
  if (mtErr) throw mtErr;
  const membershipTypeId = new Map((mTypes ?? []).map((t) => [t.slug, t.id]));

  const serviceLinks = matched.flatMap((m) =>
    servicesOf(m.wp_member_id).flatMap((slug) => {
      const service_id = serviceId.get(slug);
      return service_id ? [{ member_id: idBySlug.get(m.slug)!, service_id }] : [];
    }),
  );
  const typeLinks = matched.flatMap((m) =>
    sectorsOf(m.wp_member_id).flatMap((slug) => {
      const membership_type_id = membershipTypeId.get(slug);
      return membership_type_id ? [{ member_id: idBySlug.get(m.slug)!, membership_type_id }] : [];
    }),
  );
  say(`— links: ${serviceLinks.length} member_services, ${typeLinks.length} member_membership_types`);
  if (!DRY_RUN) {
    for (const batch of chunk(serviceLinks, 500)) {
      const { error } = await db.from("member_services").upsert(batch, { onConflict: "member_id,service_id", ignoreDuplicates: true });
      if (error) throw error;
    }
    for (const batch of chunk(typeLinks, 500)) {
      const { error } = await db.from("member_membership_types").upsert(batch, { onConflict: "member_id,membership_type_id", ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  // 6. Content inherits from its member, the same rule migration
  //    20260909000002 applied — re-run so the industries just assigned in step
  //    4 reach the stories/videos/events that were null when it ran.
  const withIndustry = resolved.filter((a) => a.industry_id != null);
  let touched = 0;
  for (const a of withIndustry) {
    for (const table of ["stories", "videos", "events"] as const) {
      const { count } = await db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("member_id", a.id)
        .is("industry_id", null);
      if (!count) continue;
      touched += count;
      if (!DRY_RUN) {
        const { error } = await db.from(table).update({ industry_id: a.industry_id }).eq("member_id", a.id).is("industry_id", null);
        if (error) throw error;
      }
    }
  }
  say(`— content inheriting a member industry: ${touched} row${touched === 1 ? "" : "s"}`);

  say(DRY_RUN ? "Dry run complete — nothing was written." : "Taxonomy backfill complete.");
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
  extraPaths: string[] = [],
) {
  // upload only media referenced by the rows being seeded
  const wanted = new Set<string>(extraPaths);
  for (const m of memberRows) for (const p of [m.logo_path, m.hero_path]) if (p) wanted.add(p as string);
  for (const s of storyRows) if (s.cover_path) wanted.add(s.cover_path);
  for (const v of videoRows) if (v.thumbnail_path) wanted.add(v.thumbnail_path as string);
  for (const e of eventRows) if (e.cover_path) wanted.add(e.cover_path as string);
  const all = manifest.filter((m) => wanted.has(m.storage_path));
  // Skip what is already there. A transient failure used to mean re-pushing the
  // whole ~1 GiB to fix a single file, because every upload is an unconditional
  // upsert. On a fresh seed the bucket was just emptied, so nothing is skipped
  // and this costs one cheap listing; on a --media-only repair it uploads only
  // the gaps. --force-media restores the old behaviour when a file's *contents*
  // have changed but its path has not.
  let uploads = all;
  if (!FORCE_MEDIA) {
    const present = await listAllObjects(db, "media");
    uploads = all.filter((m) => !present.has(m.storage_path));
    const skipped = all.length - uploads.length;
    if (skipped) console.log(`— media: ${skipped} already present, skipping (--force-media to re-upload)`);
  }
  if (!uploads.length) {
    console.log("— media: nothing to upload");
    return;
  }
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
  // First, and before anything reads EXTRACT_DIR: these rows are synthesised,
  // not extracted, so this mode works on a machine that has no export at all.
  if (DEMO_ROWS_ONLY) {
    await seedDemoRows();
    return;
  }

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
  type StoryRow = Record<string, unknown> & { wp_member_id: number | null; member_wp_ids: number[]; slug: string; category_slugs: string[]; cover_path: string | null };
  type Manifest = { source: string; storage_path: string; used_by: string }[];

  const [catRows, memberRowsAll, storyRowsAll, videoRowsAll, eventRowsAll, pageRows, manifest, rawMembers, advertRows] =
    await Promise.all([
      seed<Cat[]>("categories.seed.json"),
      seed<MemberRow[]>("members.seed.json"),
      seed<StoryRow[]>("stories.seed.json"),
      seed<Record<string, unknown>[]>("videos.seed.json"),
      seed<Record<string, unknown>[]>("events.seed.json"),
      seed<{ slug: string; title: string; body: string }[]>("static_pages.seed.json"),
      seed<Manifest>("media-manifest.json"),
      rawJson<RawMember[]>("members.json"),
      seed<LegacyAdvertRow[]>("adverts.seed.json"),
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
  // Legacy advertisers always make the local cut, or their real adverts can't
  // be imported (adverts.member_id is NOT NULL) and the slots show only SAMPLEs.
  const advertiserWpIds = new Set(advertRows.map((a) => a.wp_member_id));
  const advertiserSlugs = memberRowsAll.filter((m) => advertiserWpIds.has(m.wp_member_id)).map((m) => m.slug);
  const memberRows = selectMembers(
    memberRowsAll, industryOf, MEMBERS_LIMIT, (m) => contentPerMember.get(m.wp_member_id) ?? 0, advertiserSlugs,
  );
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

  if (LEGACY_ADVERTS_ONLY) {
    // A local DB seeded before advertisers were required may lack some. Add
    // them first — complete rows, via the same insertMembers() as a full seed.
    // Never on --remote: production has every member, and an importer that
    // invents members on a live site (say one Jas archived) is worse than a skip.
    if (!REMOTE) {
      const { data: present, error: pErr } = await db.from("members").select("slug");
      if (pErr) throw pErr;
      const have = new Set(present!.map((m) => m.slug));
      const missing = memberRowsAll.filter((m) => advertiserWpIds.has(m.wp_member_id) && !have.has(m.slug));
      if (missing.length) {
        console.log(`— advertiser members missing locally, adding ${missing.length}: ${missing.map((m) => m.slug).join(", ")}`);
        const [{ data: inds, error: iErr }, { data: svcs, error: sErr }] = await Promise.all([
          db.from("industries").select("id, slug"),
          db.from("services").select("id, slug"),
        ]);
        if (iErr) throw iErr;
        if (sErr) throw sErr;
        await insertMembers(missing, {
          industryId: (slug) => inds!.find((i) => i.slug === slug)?.id ?? null,
          serviceId: new Map(svcs!.map((x) => [x.slug, x.id])),
          servicesOf,
          sectorsOf,
        });
        if (!SKIP_MEDIA) await uploadMedia(missing, [], [], [], manifest);
      }
    }
    // memberRowsAll, not the local subset: the target decides who is there.
    await importLegacyAdverts(memberRowsAll, advertRows, manifest);
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

  if (TAXONOMIES_ONLY) {
    // Deliberately memberRowsAll, not the local subset: this repairs a target
    // that already holds every member.
    await backfillTaxonomies(memberRowsAll, catRows, servicesOf, sectorsOf);
    return;
  }

  if (EVENTS_ONLY) {
    // eventRowsAll, not the local subset: this repairs a populated target.
    await backfillEvents(eventRowsAll);
    return;
  }

  console.log("— media: clearing stale files from previous seeds");
  await emptyBucket();

  // `categories` is the news-topic vocabulary and nothing else (migration
  // 20260909000002). The extract's member-kind rows are the 69 WP Services
  // terms — seeding those as industries is what put 69 service names in the
  // industry bar. They go to the `services` tables below; industries are their
  // own table, seeded from the canonical list shared with scripts/seed.ts.
  const storyCatRows = catRows.filter((c) => c.kind === "story").map(({ slug, name }) => ({ slug, name }));
  console.log(`— categories (${storyCatRows.length} news topics)`);
  const { data: cats, error: catErr } = await db.from("categories").upsert(storyCatRows, { onConflict: "slug" }).select();
  if (catErr) throw catErr;
  const catId = (slug: string) => cats!.find((c) => c.slug === slug)?.id ?? null;

  // The migration already inserts these; upserting keeps the seed correct on a
  // database built by any route, and re-asserts the names if one was edited.
  console.log(`— industries (${INDUSTRY_ROWS.length})`);
  const { data: inds, error: indErr } = await db.from("industries").upsert(INDUSTRY_ROWS, { onConflict: "slug" }).select();
  if (indErr) throw indErr;
  const industryId = (slug: string) => inds!.find((i) => i.slug === slug)?.id ?? null;

  console.log(`— services (${catRows.length - storyCatRows.length} terms, the real /find-a-member vocabulary)`);
  const serviceRows = catRows.filter((c) => c.kind === "member").map(({ slug, name }) => ({ slug, name }));
  const { data: serviceCats, error: svcErr } = await db.from("services").upsert(serviceRows, { onConflict: "slug" }).select();
  if (svcErr) throw svcErr;
  const serviceId = new Map(serviceCats!.map((s) => [s.slug, s.id]));

  console.log(`— members (${memberRows.length})`);
  const wpToUuid = await insertMembers(memberRows, { industryId, serviceId, servicesOf, sectorsOf });
  const memberId = (wp: number | null | undefined) => (wp ? wpToUuid.get(wp) ?? null : null);
  /**
   * Content inherits its member's industry, matching migration 20260909000002's
   * backfill. Most of the archive has no member and so no industry — that is
   * the real shape of the data, not a seeding gap (docs/GO-LIVE.md 1.1).
   */
  const industryOfWp = (wp: number | null | undefined) => {
    if (!wp) return null;
    const industry = industryForServices(servicesOf(wp));
    return industry ? industryId(industrySlug(industry)) : null;
  };

  // --remote gets the real inventory, never the SAMPLE one (see seedAdverts).
  if (REMOTE) await importLegacyAdverts(memberRows, advertRows, manifest);
  else if (!NO_ADVERTS) await seedAdverts(memberRows, memberId);

  // These fixtures all share one password, hardcoded immediately below, and one
  // of them is an admin. They must never exist on a live database — anyone who
  // can read this repo could otherwise sign into the console. seedDemoRows
  // already refuses --remote (see its first line) for the same reason; this
  // block was missed, and a production seed duly created five known-password
  // accounts including `jas@smi.local` with role=admin.
  //
  // Real member logins are provisioned by provisionMember() + sendAccountInvite()
  // with a per-account password the member then resets — never from a seed.
  if (REMOTE) {
    console.log("— auth users: skipped (fixture logins are local-only)");
  } else {
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
  }

  if (SKIP_MEDIA) {
    console.log("— media: skipped");
  } else {
    await uploadMedia(memberRows, storyRows, videoRows, eventRows, manifest);
  }

  console.log(`— stories (${storyRows.length})`);
  let storyMemberLinks = 0;
  for (const rows of chunk(storyRows, 100)) {
    // `member_wp_ids` is a side-channel key like `category_slugs` — it must be
    // destructured out, not spread, or PostgREST rejects the row on a column
    // that doesn't exist. It feeds story_members (20260924000001); member_id
    // keeps the primary member so existing single-member reads still work.
    const insert = rows.map(({ wp_member_id, category_slugs, member_wp_ids, ...r }) => ({
      ...r,
      member_id: memberId(wp_member_id),
      industry_id: industryOfWp(wp_member_id),
    }));
    const { data, error } = await db.from("stories").insert(insert).select("id, slug");
    if (error) throw error;
    const junctions = data!.flatMap((st) => {
      const src = rows.find((r) => r.slug === st.slug)!;
      return src.category_slugs
        .map((slug) => catId(slug))
        .filter(Boolean)
        .map((category_id) => ({ story_id: st.id, category_id }));
    });
    if (junctions.length) {
      const { error: jErr } = await db.from("story_categories").insert(junctions);
      if (jErr) throw jErr;
    }
    // The story↔member graph. A story can name up to 13 members, so this is
    // where most of the relationship lives — member_id holds only the first.
    const memberLinks = data!.flatMap((st) => {
      const src = rows.find((r) => r.slug === st.slug)!;
      return (src.member_wp_ids ?? [])
        .map((wp) => memberId(wp))
        .filter((id): id is string => !!id)
        .map((member_id) => ({ story_id: st.id, member_id }));
    });
    if (memberLinks.length) {
      const { error: mErr } = await db
        .from("story_members")
        .upsert(memberLinks, { onConflict: "story_id,member_id", ignoreDuplicates: true });
      if (mErr) throw mErr;
      storyMemberLinks += memberLinks.length;
    }
  }
  console.log(`— story_members: ${storyMemberLinks} links`);

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
      industry_id: industryOfWp(wp_member_id as number | null),
    }));
    const { error } = await db.from("videos").insert(insert);
    if (error) throw error;
  }
  // The export DOES carry coordinates — 50 of the 53 events have real lat/lng
  // in their ACF Google Map, they were just dropped during shaping (the values
  // are PHP doubles, so a string-shaped parse found nothing). Extract data wins;
  // AUTHORED_EVENT_COORDS now only fills the handful it can't supply, which is
  // what it was written for.
  const eventInsert = eventRows.map((e) => {
    if (e.lat != null && e.lng != null) return e;
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
    { key: "home_1", label: "Homepage — top banner", cap: 3 },
    { key: "home_2", label: "Homepage — middle banner", cap: 3 },
    // The grid design's replacement for home_2 — same position, narrow column
    // (migration 20260917000001).
    { key: "home_2_narrow", label: "Homepage banner 2 — grid design (830×170)", cap: 3 },
    { key: "home_3", label: "Homepage — bottom banner", cap: 3 },
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
  // No `prospect_marks` here, unlike scripts/seed.ts: those marks point at the
  // LeadGenSource mock's fictional prospects, and this seed builds the real
  // WordPress content. Seeding invented lead-gen state next to real member data
  // is how sample prospects end up being treated as leads.
  //
  // No `email_templates` either, and for a stronger reason than that one: it is
  // an override table, and an absent row means "send the copy shipped in
  // src/lib/email/defaults.ts". Real data should go out on the real wording, so
  // empty is the correct state. scripts/seed.ts inserts a single row only to
  // give the console one "Customised" example to render.

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

  /*
   * Featured members — the grid homepage's "Featured members" box and the
   * directory's featured strip both render live `featured_member` placements
   * and nothing else, so without these two rows this seed shows an empty
   * sidebar and the videos band silently falls back to one column. The
   * synthetic seed has had them since day one (scripts/seed.ts); this one
   * never did, which is why the box looked unbuilt on real data.
   *
   * Members with a logo, since the box leads with one. Same month-long term as
   * the machine above: placements are date-driven, with no job to flip them.
   */
  console.log("— featured member placements");
  const { data: featureable } = await db
    .from("members")
    .select("id")
    .eq("status", "active")
    .not("logo_path", "is", null)
    .order("name")
    .limit(3);
  if (featureable?.length) {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const { error: fmPlErr } = await db.from("placements").insert(
      featureable.map((m) => ({
        kind: "featured_member" as const,
        member_id: m.id,
        starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
        ends_on: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      })),
    );
    if (fmPlErr) throw fmPlErr;
  } else {
    console.warn("— featured members: no active member has a logo, skipped");
  }

  // Last, and after the real events are in: it borrows their covers, and it
  // needs published stories to fill each newsletter issue. Local only —
  // seedDemoRows refuses a remote target outright.
  if (!NO_DEMO_ROWS && !REMOTE) await seedDemoRows();

  console.log("Real-content seed complete.");
  const counts = await Promise.all(
    ["members", "stories", "videos", "events", "categories", "industries", "static_pages"].map(
      async (t) => `${t}=${(await db.from(t).select("*", { count: "exact", head: true })).count}`,
    ),
  );
  console.log(counts.join(" "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
