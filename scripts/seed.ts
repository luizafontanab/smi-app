/**
 * SMI local seed: ~25 real stories from the live site's public WP REST API
 * plus synthetic members, adverts, events, newsletters, contacts, analytics.
 *
 * Expects a fresh DB. Defaults to local; a hosted project needs --remote.
 * Run: pnpm exec tsx scripts/seed.ts [--remote]
 */
import { createClient } from "@supabase/supabase-js";
import { faker } from "@faker-js/faker";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "@/lib/auth";
import { PROOF_KEYS } from "@/lib/newsletter-proof";
import { svgBanner } from "./lib/placeholder-art";
import { AUTHORED_STATIC_PAGES } from "./lib/static-page-content";
import { must } from "./lib/must";
import { assertSeedTarget } from "./lib/target-guard";
import { INDUSTRY_ROWS } from "./lib/industries";
import { runIndustryBackfill } from "./lib/industry-backfill";
import { newsTopics } from "./lib/news-topics";
import { signupWording } from "@/lib/newsletter-consent";

faker.seed(42);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY not set (load .env.local)");
assertSeedTarget(SUPABASE_URL);
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WP = "https://sheetmetalindustries.com/wp-json/wp/v2";
const UK_REGIONS = ["West Midlands", "South Yorkshire", "Greater Manchester", "East Midlands", "South East", "North West", "Scotland", "Wales", "North East", "East of England"];

const slugify = (s: string) =>
  s.toLowerCase().replace(/&[a-z0-9#]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const decode = (s: string) =>
  s.replace(/&#8217;/g, "'").replace(/&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&amp;/g, "&").replace(/&#8211;/g, "–").replace(/&hellip;/g, "…");
const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function upload(path: string, body: Buffer | Blob, contentType: string) {
  const { error } = await db.storage.from("media").upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return path;
}

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
  for (let i = 0; i < files.length; i += 100) {
    const { error: rmErr } = await db.storage.from("media").remove(files.slice(i, i + 100));
    if (rmErr) throw rmErr;
  }
}

async function main() {
  console.log("— buckets");
  // The buckets come from migration 20261020000004 (and 20261016000070); these
  // calls only cover a database the migrations haven't reached yet.
  await db.storage.createBucket("media", { public: true }).catch(() => {});
  // Invoices are private: served via signed URLs only (lib/invoice-pdf.ts).
  await db.storage.createBucket("invoices", { public: false }).catch(() => {});
  console.log("— media: clearing stale files from previous seeds");
  await emptyBucket();

  console.log("— categories (real news topics from WP) + industries");
  // WP's native "category" taxonomy: nearly every post on the live site is
  // "Uncategorized" (2060 of ~2064), with 3 strays under long-dead one-off
  // categories — not what the requirements' "~30 categories" describes. The
  // real topical taxonomy (Cutting Systems, Presses & Stamping, Welding...)
  // lives in WP's "tags", so that's what a story's category is drawn from
  // here (fix list item 16 — the previous /categories fetch left this
  // meaningless: every story landed in "Uncategorized").
  const wpCats: { id: number; name: string; slug: string; count: number }[] = await fetch(
    `${WP}/tags?per_page=50&orderby=count&order=desc`
  ).then((r) => r.json());
  const storyCats = newsTopics(wpCats.filter((c) => c.count > 0)).slice(0, 30);
  const catRows = storyCats.map((c) => ({ slug: c.slug, name: decode(c.name) }));
  const { data: cats, error: catErr } = await db.from("categories").upsert(catRows, { onConflict: "slug" }).select();
  if (catErr) throw catErr;
  const storyCatIds = cats!.map((c) => c.id);
  const wpCatMap = new Map(storyCats.map((c) => [c.id, cats!.find((x) => x.slug === c.slug)?.id]));

  // Industries are their own table, and migration 20261012000001 already
  // inserts these rows — upserting keeps the seed self-sufficient. Who is in
  // which comes from runIndustryBackfill at the end, exactly as on real data.
  const { error: indErr } = await db.from("industries").upsert(INDUSTRY_ROWS, { onConflict: "slug" });
  if (indErr) throw indErr;

  // Services: many per member. Migration 20260909000001 deliberately seeds no
  // rows — the full 69-term vocabulary comes out of the WordPress
  // `best-service` taxonomy in seed-real.ts. This is a subset of those real
  // terms, real slugs included, so the directory's Services filter and the
  // services picker have something to render AND the industry backfill maps
  // them: at least one per industry, plus one Jas left without an industry.
  const SERVICES = [
    { slug: "automation-robotics", name: "Automation / Robotics" },
    { slug: "inspection-test-measurement", name: "Inspection / Test & Measurement" },
    { slug: "grinding-lapping-polishing", name: "Grinding / Lapping / Polishing" },
    { slug: "coil-processing-cut-to-length-lines-slitting-blanking-lines", name: "Coil Processing / Cut to length lines / Slitting / Blanking lines" },
    { slug: "cutting-systems-laser-plasma-waterjet-oxyfuel", name: "Cutting Systems - Laser / Plasma / Waterjet / Oxyfuel" },
    { slug: "press-brakes-guillotines-nibbling-notching-ironworkers", name: "Press Brakes / Guillotines / Nibbling / Notching/ Ironworkers" },
    { slug: "software-cad-cam-erp", name: "Software CAD / CAM / ERP" },
    { slug: "tube-bending-and-pipe-fabrication", name: "Tube Bending and Pipe Fabrication" },
    { slug: "welding-joining-fastening", name: "Welding / Joining / Fastening" },
    { slug: "assembly", name: "Assembly" },
    { slug: "design-prototyping-services", name: "Design & Prototyping Services" },
    { slug: "training-education-providers", name: "Training / Education Providers" },
    { slug: "pr-marketing-service-providers", name: "PR / Marketing Service Providers" },
  ];
  const { data: svcs, error: svcErr } = await db
    .from("services")
    .upsert(SERVICES, { onConflict: "slug" })
    .select();
  if (svcErr) throw svcErr;
  const serviceIds = svcs!.map((s) => s.id);

  const { data: mTypes, error: mTypeErr } = await db.from("membership_types").select("id");
  if (mTypeErr) throw mTypeErr;
  const membershipTypeIds = (mTypes ?? []).map((t) => t.id);

  console.log("— members (synthetic ~85)");
  const memberRows = Array.from({ length: 85 }, (_, i) => {
    const name = `${faker.company.name().replace(/[,.]/g, "")} ${faker.helpers.arrayElement(["Ltd", "Engineering", "Fabrications", "Group", "UK"])}`;
    return {
      slug: slugify(name) + "-" + i,
      name,
      status: i < 78 ? "active" : i < 81 ? "grace" : i < 83 ? "lapsed" : "draft",
      contact_email: faker.internet.email().toLowerCase(),
      // join funnel: one draft ready to activate (paid + page submitted), one mid-funnel (neither)
      paid_at: i === 83 ? faker.date.recent({ days: 3 }).toISOString() : null,
      draft_submitted_at: i === 83 ? faker.date.recent({ days: 2 }).toISOString() : null,
      description: faker.lorem.paragraphs(2),
      address: `${faker.location.streetAddress()}, ${faker.helpers.arrayElement(UK_REGIONS)}`,
      lat: faker.location.latitude({ min: 50.5, max: 55.5 }),
      lng: faker.location.longitude({ min: -4.5, max: 1.5 }),
      phone: faker.phone.number({ style: "international" }),
      website: `https://www.${slugify(name)}.co.uk`,
      social: { linkedin: `company/${slugify(name)}`, x: slugify(name).slice(0, 15) },
      billing_mode: i % 10 === 0 ? "invoice" : "card",
      joined_at: faker.date.past({ years: 4 }).toISOString().slice(0, 10),
    };
  });
  const { data: members, error: memErr } = await db.from("members").insert(memberRows).select("id, slug, name, status");
  if (memErr) throw memErr;
  const activeMembers = members!.filter((m) => m.status === "active");

  // Both are join tables, so a member can hold several of each — that is the
  // whole reason they aren't columns. Without these links the directory's
  // Services and Membership-type filters match nothing on a synthetic seed, and
  // the member area's read-only "Membership type" row always reads "Not set".
  console.log("— member services and membership types");
  const pickSome = <T,>(pool: T[], min: number, max: number) =>
    faker.helpers.arrayElements(pool, faker.number.int({ min, max }));
  const serviceLinks = members!.flatMap((m) =>
    pickSome(serviceIds, 1, 4).map((service_id) => ({ member_id: m.id, service_id })));
  const { error: svcLinkErr } = await db.from("member_services").insert(serviceLinks);
  if (svcLinkErr) throw svcLinkErr;
  if (membershipTypeIds.length) {
    const typeLinks = members!.flatMap((m) =>
      pickSome(membershipTypeIds, 1, 2).map((membership_type_id) => ({ member_id: m.id, membership_type_id })));
    const { error: typeLinkErr } = await db.from("member_membership_types").insert(typeLinks);
    if (typeLinkErr) throw typeLinkErr;
  }

  // Member imagery (fix list). This seed used to set neither logo_path nor
  // hero_path on any of the 85 rows, so every member page rendered with no
  // artwork and there was nothing local to check crops, sizes and the logo/hero
  // overlap against. seed-real.ts gets real images from the WP extract; this is
  // the synthetic seed's equivalent, using the same committed-asset pattern as
  // the Salvagnini machine photo there.
  //
  // Real marks on faker companies, deliberately: the point is realistic aspect
  // ratios, and this seed never runs against anything but a local/throwaway DB
  // (assertSeedTarget above enforces that). The four members below cover all
  // four logo/hero combinations the member page branches on — see its own
  // comments around the -mt-16 logo overlap.
  console.log("— member logos and covers (4 of 85, spread across shapes)");
  const asset = async (file: string, slug: string, name: string, contentType: string) =>
    upload(`members/${slug}/${name}`, await readFile(path.join(HERE, "seed-assets", "members", file)), contentType);

  const imagery: { logo?: [string, string]; hero?: [string, string] }[] = [
    { logo: ["logo-square.jpeg", "image/jpeg"], hero: ["hero-1.jpg", "image/jpeg"] },   // 200×200 square + 800×400
    { logo: ["logo-extra-wide.png", "image/png"], hero: ["hero-2.jpg", "image/jpeg"] }, // 172×34, the extreme case
    { hero: ["hero-3.jpg", "image/jpeg"] },                                             // cover, no logo → ⚙ placeholder
    { logo: ["logo-wide.png", "image/png"] },                                           // 200×90 logo, no cover
  ];
  for (const [i, want] of imagery.entries()) {
    const m = activeMembers[i];
    if (!m) break;
    const ext = (f: string) => f.slice(f.lastIndexOf("."));
    const logo_path = want.logo ? await asset(want.logo[0], m.slug, `logo${ext(want.logo[0])}`, want.logo[1]) : null;
    const hero_path = want.hero ? await asset(want.hero[0], m.slug, `hero${ext(want.hero[0])}`, want.hero[1]) : null;
    const { error } = await db.from("members").update({ logo_path, hero_path }).eq("id", m.id);
    if (error) throw error;
  }

  console.log("— auth users (1 admin, media co member, 3 member logins)");
  const mkUser = async (email: string, role: Role, member_id: string | null, display_name: string) => {
    const { data, error } = await db.auth.admin.createUser({ email, password: "local-dev-password", email_confirm: true });
    if (error) throw error;
    await must("profiles", db.from("profiles").insert({ user_id: data.user.id, role, member_id, display_name }));
    return data.user.id;
  };
  const jasId = await mkUser("jas@smi.local", "admin", null, "Jas");

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
  const memberLogins: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = activeMembers[i];
    await mkUser(`member${i + 1}@smi.local`, "member", m.id, m.name);
    await must("members", db.from("members").update({ contact_email: `member${i + 1}@smi.local` }).eq("id", m.id));
    memberLogins.push(m.id);
  }

  console.log("— real stories from WP API");
  type WpPost = {
    slug: string; date: string; tags?: number[];
    title: { rendered: string }; excerpt?: { rendered: string }; content?: { rendered: string };
    _embedded?: { "wp:featuredmedia"?: { source_url?: string }[] };
  };
  const posts: WpPost[] = await fetch(`${WP}/posts?per_page=25&_embed`).then((r) => r.json());
  const storyRows: Record<string, unknown>[] = [];
  for (const [i, p] of posts.entries()) {
    let cover_path: string | null = null;
    const mediaUrl = p._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
    if (mediaUrl) {
      try {
        const img = await fetch(mediaUrl);
        if (img.ok) {
          const ext = (mediaUrl.split(".").pop() ?? "jpg").split("?")[0].slice(0, 4);
          cover_path = await upload(`stories/${slugify(p.slug)}.${ext}`, Buffer.from(await img.arrayBuffer()), img.headers.get("content-type") ?? "image/jpeg");
        }
      } catch { /* image optional in seed */ }
    }
    // every ~5th real story becomes member news attributed to a seeded member
    const asMemberNews = i % 5 === 4;
    const storyMemberId = asMemberNews ? faker.helpers.arrayElement(activeMembers).id : null;
    // In the real import 90 stories name between 2 and 13 members, which is why
    // story_members exists (20260924000001). Give every third member-news story
    // an extra member so the local database exercises that shape too, instead of
    // looking like member_id alone is enough.
    const extraMembers =
      storyMemberId && i % 15 === 14
        ? pickSome(
            activeMembers.filter((m) => m.id !== storyMemberId).map((m) => m.id),
            1,
            2,
          )
        : [];
    storyRows.push({
      story_member_ids: storyMemberId ? [storyMemberId, ...extraMembers] : [],
      slug: slugify(p.slug),
      title: decode(stripTags(p.title.rendered)),
      excerpt: decode(stripTags(p.excerpt?.rendered ?? "")).slice(0, 300),
      body: p.content?.rendered ?? "",
      status: "published",
      source: "import",
      is_member_news: asMemberNews,
      member_id: storyMemberId,
      cover_path,
      published_at: p.date,
      // SMI's own posts of the story (Jas 13/10 item 8, migration
      // 20261015000002). Every 6th story gets sample links so the story page
      // shows both cases: a real post link, and the fallback to SMI's page.
      social_posts:
        i % 6 === 0
          ? { linkedin: `https://www.linkedin.com/posts/sheet-metal-industries_seed-${i}`, x: `https://x.com/SMIUK_/status/18${String(i).padStart(8, "0")}` }
          : {},
      wp_cats: (p.tags ?? []) as number[],
    });
  }
  for (const row of storyRows) {
    const { wp_cats, story_member_ids, ...insert } = row as {
      wp_cats: number[];
      story_member_ids: string[];
    } & Record<string, unknown>;
    const { data: story, error } = await db.from("stories").insert(insert).select("id").single();
    if (error) throw error;
    const mapped = wp_cats.map((c: number) => wpCatMap.get(c)).filter(Boolean);
    const catIds = mapped.length ? mapped : [faker.helpers.arrayElement(storyCatIds)];
    await must("story_categories", db.from("story_categories").insert(catIds.map((category_id: number) => ({ story_id: story!.id, category_id }))));
    if (story_member_ids.length) {
      await must("story_members", db
        .from("story_members")
        .insert(story_member_ids.map((member_id) => ({ story_id: story!.id, member_id }))));
    }
  }
  // a couple of pipeline states for the console demo
  const pending = [
    { title: "New 6kW fibre laser installed at our Rotherham facility", status: "awaiting_approval", source: "member", member_id: memberLogins[0], is_member_news: true },
    { title: "Apprenticeship intake doubles for 2027", status: "awaiting_approval", source: "member", member_id: memberLogins[1], is_member_news: true },
    { title: "Trade show preview: what to expect at EuroBLECH", status: "awaiting_approval", source: "member", member_id: memberLogins[2], is_member_news: true },
    // Per-story social settings (Area 3, 20261020000003): one with its own
    // post time and lead-in, one that won't be posted, so each editor state shows.
    { title: "UK steel prices steady into autumn", status: "scheduled", source: "admin", member_id: null, is_member_news: false, social: "timed" as const },
    { title: "Draft: bending cell automation roundup", status: "draft", source: "admin", member_id: null, is_member_news: false, social: "skip" as const },
    // A member's own unsubmitted draft (Jas 13/10, migration 20261015000001):
    // visible to member1 under Your content → Drafts, invisible to the console.
    { title: "Draft: our new press brake line", status: "draft", source: "member", member_id: memberLogins[0], is_member_news: true, member_draft: true },
  ];
  for (const p of pending) {
    const scheduledAt = p.status === "scheduled" ? faker.date.soon({ days: 3 }) : null;
    const { data: row, error } = await db.from("stories").insert({
      slug: slugify(p.title), title: p.title, body: `<p>${faker.lorem.paragraphs(3, "</p><p>")}</p>`,
      excerpt: faker.lorem.sentence(), status: p.status, source: p.source, member_id: p.member_id,
      is_member_news: p.is_member_news, member_draft: p.member_draft ?? false,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      ...("social" in p && p.social === "timed" && scheduledAt
        ? { social_at: new Date(scheduledAt.getTime() + 2 * 3_600_000).toISOString(), social_text: "Prices held through September — what that means for your next steel order." }
        : {}),
      ...("social" in p && p.social === "skip" ? { social_skip: true } : {}),
    }).select("id").single();
    if (error) throw error;
    // story_members holds every member a story features, the primary included
    // (migration 20261015000003). The migration's backfill ran before seeding.
    if (p.member_id) await must("story_members", db.from("story_members").insert({ story_id: row!.id, member_id: p.member_id }));
  }

  console.log("— banners, bookings");
  // Banner spots are one settings row (migration 20261004000002), not per-position rows.
  const palette = ["#1e3a5f", "#7c2d12", "#14532d", "#581c87", "#7f1d1d", "#0c4a6e", "#3f6212", "#701a75"];
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthsAhead = new Date(today); monthsAhead.setMonth(monthsAhead.getMonth() + 2);
  const monthsAgo = new Date(today); monthsAgo.setMonth(monthsAgo.getMonth() - 2);
  // Seeded bookings are admin-sold and already approved: without a status they
  // would take the 'draft' default and render nothing.
  const booked = { status: "live", source: "admin", approved_at: today.toISOString(), went_live_at: monthsAgo.toISOString() };

  for (let i = 0; i < 8; i++) {
    const m = activeMembers[i + 3];
    const dPath = await upload(`panels/panel-${i}-wide.svg`, svgBanner(m.name, 1280, 170, palette[i]), "image/svg+xml");
    const mPath = await upload(`panels/panel-${i}-narrow.svg`, svgBanner(m.name, 370, 280, palette[i]), "image/svg+xml");
    const { data: ad } = await must("adverts", db.from("adverts").insert({ member_id: m.id, name: `${m.name} banner`, desktop_path: dPath, mobile_path: mPath, format: "banner" }).select("id").single());
    await must("advert_bookings", db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: i < 6 ? iso(monthsAhead) : iso(new Date(today.getTime() + 5 * 864e5)) })); // 2 expire within a week
  }
  for (let i = 0; i < 5; i++) {
    const m = activeMembers[i + 12];
    const p = await upload(`panels/mark-${i}.svg`, svgBanner(m.name.split(" ")[0], 240, 120, palette[(i + 3) % 8]), "image/svg+xml");
    const { data: ad } = await must("adverts", db.from("adverts").insert({ member_id: m.id, name: `${m.name} supplier logo`, desktop_path: p, mobile_path: p, format: "supplier_logo" }).select("id").single());
    await must("advert_bookings", db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) }));
  }

  // One booked creative per new format, so the grid design's slots can be
  // reviewed filled as well as empty.
  for (const [i, fmt] of (["skyscraper", "mpu", "in_feed"] as const).entries()) {
    const [w, h] = fmt === "skyscraper" ? [300, 600] : fmt === "mpu" ? [300, 250] : [370, 280];
    const m = activeMembers[i + 17];
    const p = await upload(`panels/${fmt}-${i}.svg`, svgBanner(m.name, w, h, palette[(i + 5) % 8]), "image/svg+xml");
    const { data: ad } = await must("adverts", db.from("adverts").insert({ member_id: m.id, name: `${m.name} ${fmt}`, desktop_path: p, mobile_path: p, format: fmt }).select("id").single());
    await must("advert_bookings", db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) }));
  }

  // Two narrow banners, so home_2_narrow has more than one advert to rotate
  // between. Their own format and therefore their own pool — 830×170 artwork
  // must never be dealt into a full-width slot (migration 20260917000001).
  for (let i = 0; i < 2; i++) {
    // 20 is the bundle member below; 21-22 are otherwise unused.
    const m = activeMembers[i + 21];
    const [dPath, mPath] = await Promise.all([
      upload(`panels/narrow-${i}-wide.svg`, svgBanner(m.name, 830, 170, palette[(i + 2) % 8]), "image/svg+xml"),
      upload(`panels/narrow-${i}-mobile.svg`, svgBanner(m.name, 370, 280, palette[(i + 2) % 8]), "image/svg+xml"),
    ]);
    const { data: ad } = await must("adverts", db.from("adverts").insert({ member_id: m.id, name: `${m.name} narrow banner`, desktop_path: dPath, mobile_path: mPath, format: "banner_narrow" }).select("id").single());
    await must("advert_bookings", db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) }));
  }

  // Sample prices (fix-list 77): a run carries its own price now that the rate
  // card is gone — so local revenue and booking pages have numbers to show.
  // Bundle parts are left unpriced; the bundle carries their price.
  const SAMPLE_PRICES: Record<string, number> = {
    banner: 65000, banner_narrow: 65000, skyscraper: 55000, mpu: 45000, in_feed: 40000, supplier_logo: 10000,
  };
  for (const [format, price_pennies] of Object.entries(SAMPLE_PRICES)) {
    const { data: ads } = await db.from("adverts").select("id").eq("format", format);
    const ids = (ads ?? []).map((a) => a.id);
    if (ids.length) await must("advert_bookings", db.from("advert_bookings").update({ price_pennies }).in("advert_id", ids).is("bundle_id", null));
  }

  // One priced bundle (A2.3/A2.7): two formats for one member, sold together
  // under a single bundle_id and price — so the bundle UI and its invoicing
  // path both have something real to show in local dev.
  console.log("— a sample bundle");
  const bundleMember = activeMembers[20];
  const { data: bundle } = await must("bundles", db.from("bundles").insert({
    member_id: bundleMember.id, name: `${bundleMember.name} launch bundle`, price_pennies: 90000, notes: "Banner + supplier logo, sold together",
  }).select("id").single());
  const bBanner = await upload("panels/bundle-banner.svg", svgBanner(bundleMember.name, 1280, 170, palette[1]), "image/svg+xml");
  const bBannerMobile = await upload("panels/bundle-banner-mobile.svg", svgBanner(bundleMember.name, 370, 280, palette[1]), "image/svg+xml");
  const bLogo = await upload("panels/bundle-logo.svg", svgBanner(bundleMember.name.split(" ")[0], 240, 120, palette[1]), "image/svg+xml");
  const { data: bBannerAd } = await must("adverts", db.from("adverts").insert({ member_id: bundleMember.id, name: `${bundleMember.name} bundle banner`, desktop_path: bBanner, mobile_path: bBannerMobile, format: "banner" }).select("id").single());
  const { data: bLogoAd } = await must("adverts", db.from("adverts").insert({ member_id: bundleMember.id, name: `${bundleMember.name} bundle logo`, desktop_path: bLogo, mobile_path: bLogo, format: "supplier_logo" }).select("id").single());
  await must("advert_bookings", db.from("advert_bookings").insert([
    { advert_id: bBannerAd!.id, bundle_id: bundle!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) },
    { advert_id: bLogoAd!.id, bundle_id: bundle!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) },
  ]));

  console.log("— placements: featured members, featured machine, grid blocks");
  const { data: fm } = await must("featured_machines", db.from("featured_machines").insert({
    member_id: activeMembers[5].id, name: "2026 Durma HD-F 3015 12kW Fibre Laser",
    description: faker.lorem.paragraph(), external_url: `https://www.${slugify(activeMembers[5].name)}.co.uk/machines/durma-hd-f`,
    image_path: await upload("machines/durma.svg", svgBanner("Featured Machine", 800, 500, "#334155"), "image/svg+xml"),
  }).select("id").single());
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  await must("placements", db.from("placements").insert([
    { kind: "featured_member", member_id: activeMembers[0].id, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
    { kind: "featured_member", member_id: activeMembers[1].id, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
    { kind: "featured_machine", featured_machine_id: fm!.id, member_id: activeMembers[5].id, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
    { kind: "grid_block", member_id: activeMembers[2].id, grid_position: 4, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
  ]));

  console.log("— events, videos");
  await must("events", db.from("events").insert([
    // lat/lng are hardcoded literals (Belfry resort / Hanover fairground) so the
    // /event map has pins in local dev — real rows get coords geocoded on save,
    // and seeds must never call Nominatim (usage policy: one lookup per save).
    { slug: "smi-golf-challenge-2026", title: "SMI Golf Challenge 2026", location: "Belfry, West Midlands", lat: 52.5623, lng: -1.7259, starts_on: "2026-09-17", status: "published", description: "The annual SMI golf day.", type: "golf_challenge" },
    { slug: "euroblech-2026", title: "EuroBLECH 2026", location: "Hanover, Germany", lat: 52.3207, lng: 9.8106, starts_on: "2026-10-20", ends_on: "2026-10-23", status: "published", link: "https://www.euroblech.com", type: "exhibition" },
    { slug: "open-house-bending-demo", title: "Open house: bending cell demo", location: faker.location.city(), starts_on: iso(new Date(today.getTime() + 30 * 864e5)), status: "awaiting_approval", member_id: memberLogins[0] },
    // past and published — the archive on /event and the "already taken place"
    // notice on /event/[slug] are otherwise unreachable from seed data
    { slug: "smi-golf-challenge-2025", title: "SMI Golf Challenge 2025", location: "Belfry, West Midlands", starts_on: iso(new Date(today.getTime() - 340 * 864e5)), status: "published", description: "<p>Last year's golf day.</p>" },
  ]));
  // Featured Event (HUMAN-TODO 4.4): an upcoming, member-owned event booked
  // unpriced from today until it starts, so the homepage's top card and the
  // console Events card show a "Booked" event rather than the fallback. Dated
  // relative to today because the two published events above are fixed dates.
  const featuredEventStart = new Date(today.getTime() + 21 * 864e5);
  const { data: featuredEventRow } = await must("events", db.from("events").insert({
    slug: "laser-cutting-open-day", title: "Laser cutting open day", location: faker.location.city(),
    starts_on: iso(featuredEventStart), status: "published", type: "open_house", member_id: activeMembers[3].id,
    description: "<p>Live demos on the latest fibre lasers.</p>",
  }).select("id").single());
  await must("placements", db.from("placements").insert({
    kind: "featured_event", event_id: featuredEventRow!.id, member_id: activeMembers[3].id,
    starts_on: iso(today), ends_on: iso(featuredEventStart),
  }));
  const ytIds = ["fLcEcOuZTBs", "kXYiU_JCYtU", "hTWKbfoikeg", "9bZkp7q19f0", "dQw4w9WgXcQ", "L_jWHffIx5E"];
  await must("videos", db.from("videos").insert(ytIds.map((v, i) => {
    const title = `${faker.company.buzzPhrase()} — shop floor tour`;
    const videoMemberId = i < 3 ? activeMembers[i + 6].id : null;
    return {
      // buzzPhrase can repeat across six rows, and videos.slug is unique — the
      // index suffix is what keeps a reseed from failing on a coincidence
      slug: `${slugify(title)}-${i}`,
      title, url: `https://www.youtube.com/watch?v=${v}`,
      description: `<p>${faker.lorem.paragraph()}</p>`,
      member_id: videoMemberId,
      status: "published", source: i < 2 ? "manual" : "curated",
      published_at: faker.date.recent({ days: 60 }).toISOString(),
    };
  })));

  console.log("— newsletter issues");
  const { data: pubStories } = await db.from("stories").select("id").eq("status", "published").limit(16);
  for (let n = 0; n < 2; n++) {
    const sentAt = new Date(today.getFullYear(), today.getMonth() - (2 - n), 3);
    // Sent issues were approved the day before, with an audience count, so the
    // console's "within 5% of last month" check (gap review area 4) has a
    // baseline to compare against.
    const { data: issue } = await must("newsletter_issues", db.from("newsletter_issues").insert({
      number: n + 47, subject: `SMI Monthly — ${["June", "July"][n]} 2026`, status: "sent",
      web_slug: `issue-${n + 47}`, sent_at: sentAt.toISOString(),
      intro: faker.lorem.paragraph(),
      preview_text: faker.lorem.sentence().slice(0, 90),
      sent_count: [104, 108][n],
      approved_at: new Date(sentAt.getTime() - 24 * 3_600_000).toISOString(),
      approved_recipients: [104, 108][n],
      proof_checks: Object.fromEntries(PROOF_KEYS.map((key) => [key, true])),
    }).select("id").single());
    await must("newsletter_items", db.from("newsletter_items").insert(pubStories!.slice(n * 8, n * 8 + 8).map((s, i) => ({ issue_id: issue!.id, story_id: s.id, position: i }))));
    // A supplier directory (gap review area 5) on each sent issue, so its web
    // copy shows one: three active members.
    const listed = (members ?? []).filter((m) => m.status === "active").slice(n * 3, n * 3 + 3);
    if (listed.length) await must("newsletter_directory", db.from("newsletter_directory").insert(listed.map((m) => ({ issue_id: issue!.id, member_id: m.id }))));
  }

  console.log("— contacts (~120)");
  await must("contacts", db.from("contacts").insert(Array.from({ length: 120 }, (_, i) => {
    const unsub = i % 17 === 0;
    // every Bigin sync state the console CRM list distinguishes: linked, never
    // pushed (inBigin false), and a local edit still waiting to go (dirty)
    const inBigin = i % 10 !== 9;
    const dirty = i % 10 === 8;
    const company = faker.company.name();
    // Consent evidence (gap review area 6): every route the CRM page labels,
    // plus some with no record at all, as older rows have in production.
    const optInSource = unsub || i % 4 === 3 ? null : (["site_form", "console", "bigin"] as const)[i % 3];
    return {
      email: faker.internet.email().toLowerCase(), name: faker.person.fullName(), company,
      member_id: i < 30 ? activeMembers[i % activeMembers.length].id : null,
      subscribed: !unsub, unsubscribed_at: unsub ? faker.date.past({ years: 1 }).toISOString() : null,
      bigin_id: inBigin ? `bigin-${1000 + i}` : null,
      bigin_company_id: inBigin && i % 3 === 0 ? `bigin-co-${2000 + i}` : null,
      bigin_company_name: inBigin && i % 3 === 0 ? company : null,
      bigin_modified_at: inBigin ? faker.date.recent({ days: 30 }).toISOString() : null,
      crm_dirty_at: dirty ? new Date().toISOString() : null,
      source: faker.helpers.arrayElement(["newsletter", "trade-show", "linkedin", "member"]),
      last_synced_at: inBigin ? new Date().toISOString() : null,
      opt_in_at: optInSource ? faker.date.past({ years: 2 }).toISOString() : null,
      opt_in_source: optInSource,
      opt_in_wording: optInSource === "site_form" ? signupWording("footer") : null,
    };
  })));

  console.log("— analytics (~90 days) + engagement audit + rollups");
  const { data: allPub } = await db.from("stories").select("id, member_id, slug").eq("status", "published");
  const { data: allAds } = await db.from("adverts").select("id").eq("format", "banner");
  const fakeCompanies = ["Midlands Aero Components", "Precision Weld UK", "Northern Laser Services", "Clyde Fabrication", "Thames Estuary Marine", null, null, null, null, null];
  const events: Record<string, unknown>[] = [];
  // A pool of returning visitors, so the console analytics page shows users,
  // new users and sessions that differ from raw views. device/country are only
  // recorded from 29 Oct 2026, so some visitors keep them null ("unknown").
  const REFERRERS = [null, null, null, "https://www.google.com/", "https://www.google.com/", "https://www.linkedin.com/", "https://www.bing.com/", "https://chatgpt.com/", "https://www.facebook.com/"];
  const visitors = Array.from({ length: 900 }, () => ({
    hash: faker.string.alphanumeric(16),
    referrer: faker.helpers.arrayElement(REFERRERS),
    device: faker.helpers.weightedArrayElement([{ weight: 7, value: "desktop" }, { weight: 3, value: "mobile" }, { weight: 1, value: "tablet" }, { weight: 2, value: null }]),
    country: faker.helpers.weightedArrayElement([{ weight: 8, value: "GB" }, { weight: 1, value: "IE" }, { weight: 1, value: "US" }, { weight: 1, value: "DE" }, { weight: 2, value: null }]),
  }));
  for (let d = 90; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 864e5);
    const views = faker.number.int({ min: 40, max: 110 });
    for (let v = 0; v < views; v++) {
      const t = new Date(day.getTime() + faker.number.int({ min: 8, max: 20 }) * 3600e3);
      const story = faker.helpers.arrayElement(allPub!);
      const region = faker.helpers.arrayElement(UK_REGIONS);
      const visitor = faker.helpers.arrayElement(visitors);
      events.push({ occurred_at: t.toISOString(), kind: "story_view", path: `/news/${story.slug}`, story_id: story.id, member_id: story.member_id, region, session_hash: visitor.hash, referrer: visitor.referrer, device: visitor.device, country: visitor.country });
      if (v % 6 === 0) events.push({ occurred_at: t.toISOString(), kind: "page_view", path: faker.helpers.arrayElement(["/", "/news", "/member", "/event", "/video"]), session_hash: visitor.hash, referrer: visitor.referrer, device: visitor.device, country: visitor.country });
      events.push({ occurred_at: t.toISOString(), kind: "ad_impression", advert_id: faker.helpers.arrayElement(allAds!).id, region });
      if (v % 25 === 0) events.push({ occurred_at: t.toISOString(), kind: "ad_click", advert_id: faker.helpers.arrayElement(allAds!).id, region });
      if (v % 12 === 0) {
        const m = faker.helpers.arrayElement(activeMembers);
        events.push({ occurred_at: t.toISOString(), kind: "member_page_view", member_id: m.id, region, company: faker.helpers.arrayElement(fakeCompanies) });
      }
    }
  }
  for (let i = 0; i < events.length; i += 1000) {
    const { error } = await db.from("analytics_events").insert(events.slice(i, i + 1000));
    if (error) throw error;
  }
  const audit = memberLogins.flatMap((mid) =>
    Array.from({ length: 6 }, () => ({
      member_id: mid, occurred_on: iso(faker.date.recent({ days: 14 })),
      region: faker.helpers.arrayElement(UK_REGIONS),
      company: faker.helpers.arrayElement(fakeCompanies.filter(Boolean) as string[]),
      page: "member page", views: faker.number.int({ min: 1, max: 9 }),
    }))
  );
  await must("engagement_audit", db.from("engagement_audit").insert(audit));

  console.log("— invoices, prefs, static pages, settings");
  await must("invoices", db.from("invoices").insert(memberLogins.flatMap((mid, i) =>
    Array.from({ length: 3 }, (_, k) => ({
      member_id: mid, number: `SMI-${2026}-${(i + 1) * 100 + k}`, amount_pennies: 4000,
      issued_on: iso(new Date(today.getFullYear(), today.getMonth() - k, 1)), status: k === 0 ? "issued" : "paid",
      // paid a week after issue. paid_at (20261006000002) is stamped by
      // settle_invoice and read by /dashboard/pay/invoice/[id]; the app never
      // writes a paid invoice without one, so the seed shouldn't either
      paid_at: k === 0 ? null : new Date(today.getFullYear(), today.getMonth() - k, 8).toISOString(),
    }))
  )));
  await must("notification_prefs", db.from("notification_prefs").insert(memberLogins.map((mid) => ({ member_id: mid }))));
  // The join tests (unit + e2e) redeem these; without them the promo path only
  // works on a database an admin has hand-populated via /console/promo-codes.
  await must("promo_codes", db.from("promo_codes").insert([
    { code: "SMI-FREE-YEAR", months: 12, active: true },
    { code: "SMI-FREE-MONTH", months: 1, active: true },
  ]));
  // PostgREST bulk inserts need uniform keys across rows, so default the
  // per-row `collapsible` flag explicitly rather than omitting it.
  const pageRow = (p: { slug: string; title: string; body: string; collapsible?: boolean }) =>
    ({ collapsible: false, ...p });
  // `policies` is authored now, so it comes from AUTHORED_STATIC_PAGES — a
  // second stub row here duplicated the primary key and, unchecked, silently
  // dropped every static page from the seed.
  const { error: pagesError } = await db.from("static_pages").insert([
    ...AUTHORED_STATIC_PAGES, // real live-site copy (about, faq, policies, terms) — same rows seed-real.ts merges in
    { slug: "advertising", title: "Advertise with SMI", body: "<p>Formats A–F, media pack available on request.</p>" },
    { slug: "mach-publication", title: "MACH Publication", body: "<p>Our MACH show magazine.</p>" },
    // The standalone pages the live site has and we did not. Slugs are flat, so
    // the old nesting (/contact/press-release-submissions-guide) is flattened
    // and redirected in next.config.ts — keep the two lists in step.
    { slug: "what-is-a-member-microsite", title: "What is a member microsite?", body: "<p>What your SMI page gives you.</p>" },
    { slug: "press-release-submissions-guide", title: "Press release submissions guide", body: "<p>How to send us your news.</p>" },
    { slug: "require-banner-design-help", title: "Need help designing a banner?", body: "<p>Our studio can build your artwork.</p>" },
    { slug: "smi-golf-challenge-2024", title: "SMI Golf Challenge 2024 — a swinging success", body: "<p>How the 2024 golf day went.</p>" },
    { slug: "smi-golf-day-2025", title: "SMI Golf Day 2025", body: "<p>The 2025 golf day.</p>" },
    { slug: "welcome-to-the-smi-golf-challenge", title: "Welcome to the SMI Golf Challenge", body: "<p>About the annual golf challenge.</p>" },
    { slug: "plans-in-place-for-future-growth", title: "Plans in place for future growth", body: "<p>Where SMI is heading.</p>" },
    { slug: "newsletter-archive", title: "Newsletter archive", body: "<p>Every issue we have sent.</p>" },
  ].map(pageRow));
  if (pagesError) throw new Error(`static_pages seed failed: ${pagesError.message}`);
  await must("settings", db.from("settings").insert([
    { key: "grid", value: { blocks: 12, mix: { news: 6, video: 2, member_news: 2, featured_member: 1, featured_machine: 1 } } },
    { key: "social_caps", value: { per_day: 3, delay_minutes: 30 } },
    // The site-wide design (GAPS A8.2). Grid is also the code fallback; the row
    // makes the console's "live now" reflect a real choice.
    { key: "site_variant", value: "grid" },
    // Feature flags (lib/feature-flags.ts). Member Leads defaults off in code;
    // on here so the smoke, a11y and visual suites keep covering the page.
    { key: "feature:member_leads", value: true },
    // Story crawler defaults off in code; on here so the console shows it running.
    // The synthetic sources below are paused, so no real site is ever fetched.
    { key: "feature:story_crawler", value: true },
  ]));
  // Lead-gen marks (GAPS A8.3). Refs are copied from the LeadGenSource mock's
  // fixtures rather than imported from it: the adapter pulls in src/lib/db/server,
  // which is `server-only` and can't be imported from a script.
  //
  // Admin marks only, deliberately. A member's visible prospects are a rotation
  // keyed on their member id, which is a uuid generated by this very seed run —
  // so a seeded member mark could easily point at a prospect outside that
  // member's window and render nothing at all. Better no row than a silent one.
  await must("prospect_marks", db.from("prospect_marks").insert([
    { prospect_ref: "https://www.linkedin.com/company/pennine-press-brake-services", action: "call", member_id: null },
    { prospect_ref: "https://www.linkedin.com/company/calder-laser-cutting", action: "email", member_id: null },
    { prospect_ref: "https://www.linkedin.com/company/beresford-tooling", action: "sequence", member_id: null },
  ]));

  /*
   * Console inbox (fix-list 71). Neither seed wrote a single `inbox_messages`
   * row, so `/console/notifications` and the Command Centre's Messages card
   * both rendered empty locally and the feature could not be judged at all.
   *
   * Both categories, deliberately, because the whole point of the change is
   * that they are different things and the page has to show the difference:
   *   · messages    — a person wrote it, it needs a reply, the reply form shows.
   *   · notifications — something happened, it links to the thing, no reply.
   *
   * The notification payloads carry real ids read back from this same run, so
   * every "Open it →" on the seeded feed lands on a row that exists. A row with
   * an id that does not resolve would demo the exact failure this is fixing.
   */
  console.log("— console inbox (messages + notifications)");
  const { data: seedPendingStory } = await db.from("stories").select("id").eq("status", "awaiting_approval").limit(1).single();
  const { data: seedPendingEvent } = await db.from("events").select("id").eq("status", "awaiting_approval").limit(1).single();
  const { data: seedBooking } = await db.from("advert_bookings").select("id").limit(1).single();
  const hoursAgo = (h: number) => new Date(today.getTime() - h * 3600_000).toISOString();
  // PostgREST bulk inserts need uniform keys across rows (same reason
  // `pageRow` exists below), so every row is built through this rather than
  // written out with whichever fields it happens to need.
  const inboxRow = (r: {
    category: string; kind: string; name: string; message: string;
    hours: number; read?: boolean; email?: string; memberId?: string | null;
    payload?: Record<string, string>; repliedHours?: number | null;
  }) => ({
    category: r.category,
    kind: r.kind,
    name: r.name,
    email: r.email ?? "",
    message: r.message,
    read: r.read ?? false,
    created_at: hoursAgo(r.hours),
    replied_at: r.repliedHours ? hoursAgo(r.repliedHours) : null,
    member_id: r.memberId ?? null,
    payload: r.payload ?? {},
  });
  await must("inbox_messages", db.from("inbox_messages").insert([
    inboxRow({
      category: "message", kind: "contact", hours: 2,
      name: "Gareth Pryce", email: "gareth@pryce-fabrication.co.uk",
      message: "We're looking for a supplier who can laser-cut 6mm stainless in batches of 200.\n\nCan you point me at any members in South Wales?",
    }),
    inboxRow({
      category: "message", kind: "advertising", hours: 9,
      name: "Hannah Okoro", email: "h.okoro@vantagetooling.com",
      message: "What does a homepage banner cost for a three-month run, and do you have any slots in the new year?",
    }),
    // Read and answered, so the list's "Replied" badge and the reply thread on
    // the detail page both have something to render.
    inboxRow({
      category: "message", kind: "membership", hours: 40, read: true, repliedHours: 38,
      name: activeMembers[0].name, email: "member1@smi.local", memberId: memberLogins[0],
      message: "Could you change the phone number on our company page? The one listed is the old switchboard.",
    }),
    inboxRow({
      category: "notification", kind: "story_submitted", hours: 1,
      name: activeMembers[0].name, memberId: memberLogins[0],
      payload: seedPendingStory ? { story_id: seedPendingStory.id } : {},
      message: "Submitted a story for approval: “New 6kW fibre laser installed at our Rotherham facility”.",
    }),
    inboxRow({
      category: "notification", kind: "event_submitted", hours: 5,
      name: activeMembers[1].name, memberId: memberLogins[1],
      payload: seedPendingEvent ? { event_id: seedPendingEvent.id } : {},
      message: "Submitted an event for approval: “Open house: bending cell demo”.",
    }),
    inboxRow({
      category: "notification", kind: "signup_started", hours: 20,
      name: activeMembers[2].name, memberId: memberLogins[2],
      payload: { member_id: memberLogins[2] },
      message: "Started the join flow: account created, draft company page in place. Next step: payment.",
    }),
    // The row that made the conflation concrete: it used to be written as an
    // `advertising` enquiry with an empty email, so the console offered a reply
    // form addressed to nobody. Seeded so that stays visibly fixed.
    inboxRow({
      category: "notification", kind: "advert_ending", hours: 54, read: true,
      name: `${activeMembers[2].name} banner`,
      payload: seedBooking ? { booking_id: seedBooking.id } : {},
      message: `Advert run "${activeMembers[2].name} banner" ends on ${iso(new Date(today.getTime() + 5 * 864e5))} — worth asking about a renewal.`,
    }),
    inboxRow({
      category: "notification", kind: "payment_taken", hours: 72, read: true,
      name: activeMembers[1].name, memberId: memberLogins[1],
      payload: { member_id: memberLogins[1] },
      message: "Paid £40/month by card (simulated). Next step: build their page.",
    }),
  ]));

  // One edited email template, not twenty-nine. `email_templates` is an
  // override table: a kind with no row here renders the copy shipped in
  // src/lib/email/defaults.ts, which is the normal state and the one the console
  // has to look right in. Seeding all of them would make "Customised" the
  // default badge on every row and hide the distinction the list page is built
  // around. This single partial row — subject changed, body left null — is here
  // so both states are visible, and so the visual baseline covers both.
  await must("email_templates", db.from("email_templates").insert({
    kind: "welcome",
    family: "member",
    subject: "Welcome to Sheet Metal Industries — you're in",
  }));

  const { DEFAULT_LAYOUTS } = await import("../src/lib/blocks/defaults");
  await must("page_layouts", db.from("page_layouts").insert(
    Object.entries(DEFAULT_LAYOUTS).map(([page_type, layout]) => ({ page_type, entity_id: null, layout })),
  ));
  await must("jobs", db.from("jobs").insert({ kind: "newsletter_draft_reminder", payload: { month: iso(today).slice(0, 7) }, due_at: new Date().toISOString() }));

  console.log("— dev board");
  await must("dev_tasks", db.from("dev_tasks").insert([
    { title: "Fix double-submit on the join form", status: "not_started", assignee: "Luiza", priority: "high", sort_order: 0,
      kind: "bug", description: "Clicking Pay twice creates two Stripe sessions.",
      notes: "Page: /join/account — \"Join | SMI\"\nURL: https://smi.local/join/account\n\nEnvironment\n  Viewport 1440x900 · screen 2560x1440 · DPR 2 · theme forge\n  Locale en-GB · Europe/London\n  UA Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)\n\nRecent client errors: none.",
      context: { page: { pathname: "/join/account", url: "https://smi.local/join/account", title: "Join | SMI", referrer: "" }, env: { user_agent: "Mozilla/5.0", viewport: "1440x900", screen: "2560x1440", dpr: 2, theme: "forge", language: "en-GB", timezone: "Europe/London" }, errors: [], captured_at: new Date().toISOString(), reporter: { user_id: jasId, email: "jas@smi.local", role: "admin" } },
      page_path: "/join/account", created_by: jasId, reporter_email: "jas@smi.local" },
    { title: "Improve the empty state on the members search", status: "not_started", assignee: "Luiza", priority: "low", sort_order: 1,
      kind: "idea", description: "\"No results\" reads a bit bare — could suggest clearing filters." },
    { title: "Typo in the About page footer", status: "coding", assignee: "Luiza", priority: "medium", sort_order: 0,
      kind: "copy", description: "\"buisness\" should be \"business\"." },
    { title: "Add pagination to the news archive", status: "coding", assignee: "Rishi", priority: "medium", sort_order: 1,
      description: "Waiting on the new /news route's data layer landing first." },
    { title: "Wire up the newsletter unsubscribe link", status: "in_staging", assignee: "Jas", priority: "high", sort_order: 0 },
    { title: "Audit alt text across the member directory", status: "done", assignee: "Rishi", priority: "low", sort_order: 0 },
    { title: "Spike: image CDN options", status: "done", assignee: "Jas", priority: "low", sort_order: 1 },
    { title: "Old machine listing importer", status: "canceled", assignee: null, priority: "low", sort_order: 0 },
  ], { defaultToNull: false }));

  console.log("— story sources (synthetic, paused) + suggestions");
  // Example addresses, paused: the synthetic seed must never send the
  // source_watch job at real company sites. seed-real.ts imports the real list.
  const { data: sources } = await must("content_sources", db.from("content_sources").insert([
    // Linked to a (fictional) Bigin company and a member, as the Bigin sync
    // leaves a page that is on the spreadsheet too (lib/sources/bigin.ts).
    { url: "https://example-fabrication.test/news/", domain: "example-fabrication.test", label: "Example Fabrication", active: false,
      bigin_account_id: "seed-bigin-company-1", bigin_account_name: "Example Fabrication Ltd", member_id: activeMembers[0]?.id ?? null, method: "feed", method_url: "https://example-fabrication.test/feed/", access: "ok", last_checked_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), last_item_at: new Date(Date.now() - 2 * 864e5).toISOString() },
    { url: "https://example-laser.test/blog/", domain: "example-laser.test", label: "Example Laser Cutting", active: false, method: "html", method_url: "https://example-laser.test/blog/", access: "ok", last_checked_at: new Date().toISOString(), last_ok_at: new Date().toISOString() },
    { url: "https://example-blocked.test/news/", domain: "example-blocked.test", active: false, access: "blocked", last_checked_at: new Date().toISOString(), failure_count: 1, last_error: "HTTP 403 — the site refuses automated requests" },
    { url: "https://example-moved.test/latest-news/", domain: "example-moved.test", active: false, access: "not_found", last_checked_at: new Date().toISOString(), failure_count: 2, last_error: "HTTP 404 — the news page has moved or gone" },
  ], { defaultToNull: false }).select("id, domain"));
  const sourceId = (domain: string) => sources!.find((s) => s.domain === domain)!.id;
  await must("source_items", db.from("source_items").insert([
    { source_id: sourceId("example-fabrication.test"), url: "https://example-fabrication.test/news/new-fibre-laser-installed/", title: "New 12kW fibre laser installed at our Sheffield site", published_at: new Date(Date.now() - 2 * 864e5).toISOString(), state: "new" },
    { source_id: sourceId("example-fabrication.test"), url: "https://example-fabrication.test/news/apprentice-of-the-year/", title: "Apprentice of the year award for our press brake team", published_at: new Date(Date.now() - 5 * 864e5).toISOString(), state: "new" },
    { source_id: sourceId("example-laser.test"), url: "https://example-laser.test/blog/iso-9001-renewed/", title: "ISO 9001 certification renewed for another three years", state: "new" },
    { source_id: sourceId("example-laser.test"), url: "https://example-laser.test/blog/old-post/", title: "An older post that was there on the first check", state: "baseline" },
  ]));
  // One suggestion already started, as "Start story" leaves it: a draft with the
  // third-person rewrite, and the article's own text kept in story_originals.
  const startedUrl = "https://example-laser.test/blog/second-press-brake/";
  const { data: started } = await must("stories (from suggestion)", db.from("stories").insert({
    title: "Example Laser Cutting adds a second press brake",
    slug: "example-laser-cutting-adds-a-second-press-brake",
    excerpt: "The company has doubled its bending capacity.",
    body: "<p>Example Laser Cutting has installed a second press brake, doubling its bending capacity.</p><p>\"We're delighted,\" said the works manager.</p>",
    status: "draft", source: "admin",
  }).select("id").single());
  await must("source_items (started)", db.from("source_items").insert({
    source_id: sourceId("example-laser.test"), url: startedUrl, title: "We've added a second press brake", state: "drafted", story_id: started!.id,
  }));
  await must("story_originals", db.from("story_originals").insert({
    story_id: started!.id, source_url: startedUrl, rewritten: true,
    body: "<p>We have installed a second press brake, doubling our bending capacity.</p><p>\"We're delighted,\" said the works manager.</p>",
  }));

  // Industries for every member and piece of content, from the member_services
  // and story_categories written above — the same backfill real data gets.
  await runIndustryBackfill(db);

  console.log("Seed complete.");
  const counts = await Promise.all(
    ["members", "stories", "adverts", "contacts", "events", "videos"].map(async (t) => `${t}=${(await db.from(t).select("*", { count: "exact", head: true })).count}`)
  );
  console.log(counts.join(" "));
}

main().catch((e) => { console.error(e); process.exit(1); });
