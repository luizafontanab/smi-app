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
import { svgBanner } from "./lib/placeholder-art";
import { AUTHORED_STATIC_PAGES } from "./lib/static-page-content";
import { assertSeedTarget } from "./lib/target-guard";
import { INDUSTRY_ROWS } from "./lib/industries";

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
  const storyCats = wpCats.filter((c) => c.count > 0).slice(0, 30);
  const catRows = storyCats.map((c) => ({ slug: c.slug, name: decode(c.name) }));
  const { data: cats, error: catErr } = await db.from("categories").upsert(catRows, { onConflict: "slug" }).select();
  if (catErr) throw catErr;
  const storyCatIds = cats!.map((c) => c.id);
  const wpCatMap = new Map(storyCats.map((c) => [c.id, cats!.find((x) => x.slug === c.slug)?.id]));

  // Industries are their own table since 20260909000002, and that migration
  // already inserts these rows — upserting keeps the seed self-sufficient.
  const { data: inds, error: indErr } = await db.from("industries").upsert(INDUSTRY_ROWS, { onConflict: "slug" }).select();
  if (indErr) throw indErr;
  const industryIds = inds!.map((i) => i.id);

  // Services: many per member, distinct from the single industry above. Migration
  // 20260909000001 deliberately seeds no rows — the real 69-term vocabulary comes
  // out of the WordPress `best-service` taxonomy in seed-real.ts. This is a
  // representative subset so the synthetic seed still exercises the directory's
  // Services filter and the member profile's services picker, which otherwise
  // render against an empty table. Not shared with INDUSTRY_ROWS-style constants
  // on purpose: the two seeds legitimately carry different vocabularies here.
  const SERVICE_NAMES = [
    "Assembly", "Automation / Robotics", "Bending / Folding", "Consultancy Services",
    "Design & Prototyping Services", "Finishing / Coating", "Laser Cutting Services",
    "Powder Coating", "Press Braking", "Punching Services", "Tube Bending", "Welding / Fabrication",
  ];
  const { data: svcs, error: svcErr } = await db
    .from("services")
    .upsert(SERVICE_NAMES.map((name) => ({ slug: slugify(name), name })), { onConflict: "slug" })
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
      industry_id: faker.helpers.arrayElement(industryIds),
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
  const { data: members, error: memErr } = await db.from("members").insert(memberRows).select("id, slug, name, status, industry_id");
  if (memErr) throw memErr;
  const activeMembers = members!.filter((m) => m.status === "active");
  /** Content inherits its member's industry, matching migration 20260909000002. */
  const industryOfMember = (id: string | null) =>
    id ? members!.find((m) => m.id === id)?.industry_id ?? null : null;

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
    await db.from("profiles").insert({ user_id: data.user.id, role, member_id, display_name });
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
    await db.from("members").update({ contact_email: `member${i + 1}@smi.local` }).eq("id", m.id);
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
    storyRows.push({
      slug: slugify(p.slug),
      title: decode(stripTags(p.title.rendered)),
      excerpt: decode(stripTags(p.excerpt?.rendered ?? "")).slice(0, 300),
      body: p.content?.rendered ?? "",
      status: "published",
      source: "import",
      is_member_news: asMemberNews,
      member_id: storyMemberId,
      industry_id: industryOfMember(storyMemberId),
      cover_path,
      published_at: p.date,
      wp_cats: (p.tags ?? []) as number[],
    });
  }
  for (const row of storyRows) {
    const { wp_cats, ...insert } = row as { wp_cats: number[] } & Record<string, unknown>;
    const { data: story, error } = await db.from("stories").insert(insert).select("id").single();
    if (error) throw error;
    const mapped = wp_cats.map((c: number) => wpCatMap.get(c)).filter(Boolean);
    const catIds = mapped.length ? mapped : [faker.helpers.arrayElement(storyCatIds)];
    await db.from("story_categories").insert(catIds.map((category_id: number) => ({ story_id: story!.id, category_id })));
  }
  // a couple of pipeline states for the console demo
  const pending = [
    { title: "New 6kW fibre laser installed at our Rotherham facility", status: "awaiting_approval", source: "member", member_id: memberLogins[0], is_member_news: true },
    { title: "Apprenticeship intake doubles for 2027", status: "awaiting_approval", source: "member", member_id: memberLogins[1], is_member_news: true },
    { title: "Trade show preview: what to expect at EuroBLECH", status: "awaiting_approval", source: "member", member_id: memberLogins[2], is_member_news: true },
    { title: "UK steel prices steady into autumn", status: "scheduled", source: "admin", member_id: null, is_member_news: false },
    { title: "Draft: bending cell automation roundup", status: "draft", source: "admin", member_id: null, is_member_news: false },
  ];
  for (const p of pending) {
    await db.from("stories").insert({
      slug: slugify(p.title), title: p.title, body: `<p>${faker.lorem.paragraphs(3, "</p><p>")}</p>`,
      excerpt: faker.lorem.sentence(), status: p.status, source: p.source, member_id: p.member_id,
      industry_id: industryOfMember(p.member_id),
      is_member_news: p.is_member_news,
      scheduled_at: p.status === "scheduled" ? faker.date.soon({ days: 3 }).toISOString() : null,
    });
  }

  console.log("— advert slots, banners, bookings");
  await db.from("advert_slots").insert([
    { key: "home_1", label: "Homepage banner 1", cap: 3 },
    { key: "home_2", label: "Homepage banner 2", cap: 3 },
    // The grid design's replacement for home_2 — same position, narrow column
    // (migration 20260917000001).
    { key: "home_2_narrow", label: "Homepage banner 2 — grid design (830×170)", cap: 3 },
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
    const { data: ad } = await db.from("adverts").insert({ member_id: m.id, name: `${m.name} banner`, desktop_path: dPath, mobile_path: mPath, format: "banner" }).select("id").single();
    await db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: i < 6 ? iso(monthsAhead) : iso(new Date(today.getTime() + 5 * 864e5)) }); // 2 expire within a week
  }
  for (let i = 0; i < 5; i++) {
    const m = activeMembers[i + 12];
    const p = await upload(`panels/mark-${i}.svg`, svgBanner(m.name.split(" ")[0], 240, 120, palette[(i + 3) % 8]), "image/svg+xml");
    const { data: ad } = await db.from("adverts").insert({ member_id: m.id, name: `${m.name} supplier logo`, desktop_path: p, mobile_path: p, format: "supplier_logo" }).select("id").single();
    await db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
  }

  // One booked creative per new format, so the grid design's slots can be
  // reviewed filled as well as empty.
  for (const [i, fmt] of (["skyscraper", "mpu", "in_feed"] as const).entries()) {
    const [w, h] = fmt === "skyscraper" ? [300, 600] : fmt === "mpu" ? [300, 250] : [370, 280];
    const m = activeMembers[i + 17];
    const p = await upload(`panels/${fmt}-${i}.svg`, svgBanner(m.name, w, h, palette[(i + 5) % 8]), "image/svg+xml");
    const { data: ad } = await db.from("adverts").insert({ member_id: m.id, name: `${m.name} ${fmt}`, desktop_path: p, mobile_path: p, format: fmt }).select("id").single();
    await db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
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
    const { data: ad } = await db.from("adverts").insert({ member_id: m.id, name: `${m.name} narrow banner`, desktop_path: dPath, mobile_path: mPath, format: "banner_narrow" }).select("id").single();
    await db.from("advert_bookings").insert({ advert_id: ad!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
  }

  // Rate card (A2.7): sample rates so local dev has priced products to book
  // against and invoice off, instead of every rate_pennies being null.
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

  // One priced bundle (A2.3/A2.7): two formats for one member, sold together
  // under a single bundle_id and price — so the bundle UI and its invoicing
  // path both have something real to show in local dev.
  console.log("— a sample bundle");
  const bundleMember = activeMembers[20];
  const { data: bundle } = await db.from("bundles").insert({
    member_id: bundleMember.id, name: `${bundleMember.name} launch bundle`, price_pennies: 90000, notes: "Banner + supplier logo, sold together",
  }).select("id").single();
  const bBanner = await upload("panels/bundle-banner.svg", svgBanner(bundleMember.name, 1280, 170, palette[1]), "image/svg+xml");
  const bBannerMobile = await upload("panels/bundle-banner-mobile.svg", svgBanner(bundleMember.name, 370, 280, palette[1]), "image/svg+xml");
  const bLogo = await upload("panels/bundle-logo.svg", svgBanner(bundleMember.name.split(" ")[0], 240, 120, palette[1]), "image/svg+xml");
  const { data: bBannerAd } = await db.from("adverts").insert({ member_id: bundleMember.id, name: `${bundleMember.name} bundle banner`, desktop_path: bBanner, mobile_path: bBannerMobile, format: "banner" }).select("id").single();
  const { data: bLogoAd } = await db.from("adverts").insert({ member_id: bundleMember.id, name: `${bundleMember.name} bundle logo`, desktop_path: bLogo, mobile_path: bLogo, format: "supplier_logo" }).select("id").single();
  await db.from("advert_bookings").insert([
    { advert_id: bBannerAd!.id, bundle_id: bundle!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) },
    { advert_id: bLogoAd!.id, bundle_id: bundle!.id, ...booked, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) },
  ]);

  console.log("— placements: featured members, featured machine, grid blocks");
  const { data: fm } = await db.from("featured_machines").insert({
    member_id: activeMembers[5].id, name: "2026 Durma HD-F 3015 12kW Fibre Laser",
    description: faker.lorem.paragraph(), external_url: `https://www.${slugify(activeMembers[5].name)}.co.uk/machines/durma-hd-f`,
    image_path: await upload("machines/durma.svg", svgBanner("Featured Machine", 800, 500, "#334155"), "image/svg+xml"),
  }).select("id").single();
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  await db.from("placements").insert([
    { kind: "featured_member", member_id: activeMembers[0].id, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
    { kind: "featured_member", member_id: activeMembers[1].id, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
    { kind: "featured_machine", featured_machine_id: fm!.id, member_id: activeMembers[5].id, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
    { kind: "grid_block", member_id: activeMembers[2].id, grid_position: 4, starts_on: iso(new Date(today.getFullYear(), today.getMonth(), 1)), ends_on: iso(monthEnd) },
  ]);

  console.log("— events, videos");
  await db.from("events").insert([
    // lat/lng are hardcoded literals (Belfry resort / Hanover fairground) so the
    // /event map has pins in local dev — real rows get coords geocoded on save,
    // and seeds must never call Nominatim (usage policy: one lookup per save).
    { slug: "smi-golf-challenge-2026", title: "SMI Golf Challenge 2026", location: "Belfry, West Midlands", lat: 52.5623, lng: -1.7259, starts_on: "2026-09-17", status: "published", description: "The annual SMI golf day.", type: "golf_challenge" },
    { slug: "euroblech-2026", title: "EuroBLECH 2026", location: "Hanover, Germany", lat: 52.3207, lng: 9.8106, starts_on: "2026-10-20", ends_on: "2026-10-23", status: "published", link: "https://www.euroblech.com", type: "exhibition" },
    { slug: "open-house-bending-demo", title: "Open house: bending cell demo", location: faker.location.city(), starts_on: iso(new Date(today.getTime() + 30 * 864e5)), status: "awaiting_approval", member_id: memberLogins[0], industry_id: industryOfMember(memberLogins[0]) },
    // past and published — the archive on /event and the "already taken place"
    // notice on /event/[slug] are otherwise unreachable from seed data
    { slug: "smi-golf-challenge-2025", title: "SMI Golf Challenge 2025", location: "Belfry, West Midlands", starts_on: iso(new Date(today.getTime() - 340 * 864e5)), status: "published", description: "<p>Last year's golf day.</p>" },
  ]);
  const ytIds = ["fLcEcOuZTBs", "kXYiU_JCYtU", "hTWKbfoikeg", "9bZkp7q19f0", "dQw4w9WgXcQ", "L_jWHffIx5E"];
  await db.from("videos").insert(ytIds.map((v, i) => {
    const title = `${faker.company.buzzPhrase()} — shop floor tour`;
    const videoMemberId = i < 3 ? activeMembers[i + 6].id : null;
    return {
      // buzzPhrase can repeat across six rows, and videos.slug is unique — the
      // index suffix is what keeps a reseed from failing on a coincidence
      slug: `${slugify(title)}-${i}`,
      title, url: `https://www.youtube.com/watch?v=${v}`,
      description: `<p>${faker.lorem.paragraph()}</p>`,
      member_id: videoMemberId, industry_id: industryOfMember(videoMemberId),
      status: "published", source: i < 2 ? "manual" : "curated",
      published_at: faker.date.recent({ days: 60 }).toISOString(),
    };
  }));

  console.log("— newsletter issues");
  const { data: pubStories } = await db.from("stories").select("id").eq("status", "published").limit(16);
  for (let n = 0; n < 2; n++) {
    const { data: issue } = await db.from("newsletter_issues").insert({
      number: n + 47, subject: `SMI Monthly — ${["June", "July"][n]} 2026`, status: "sent",
      web_slug: `issue-${n + 47}`, sent_at: new Date(today.getFullYear(), today.getMonth() - (2 - n), 3).toISOString(),
      intro: faker.lorem.paragraph(),
    }).select("id").single();
    await db.from("newsletter_items").insert(pubStories!.slice(n * 8, n * 8 + 8).map((s, i) => ({ issue_id: issue!.id, story_id: s.id, position: i })));
  }

  console.log("— contacts (~120)");
  await db.from("contacts").insert(Array.from({ length: 120 }, (_, i) => {
    const unsub = i % 17 === 0;
    return {
      email: faker.internet.email().toLowerCase(), name: faker.person.fullName(), company: faker.company.name(),
      member_id: i < 30 ? activeMembers[i % activeMembers.length].id : null,
      subscribed: !unsub, unsubscribed_at: unsub ? faker.date.past({ years: 1 }).toISOString() : null,
      bigin_id: `bigin-${1000 + i}`, source: faker.helpers.arrayElement(["newsletter", "trade-show", "linkedin", "member"]),
      last_synced_at: new Date().toISOString(),
    };
  }));

  console.log("— analytics (~90 days) + engagement audit + rollups");
  const { data: allPub } = await db.from("stories").select("id, member_id").eq("status", "published");
  const { data: allAds } = await db.from("adverts").select("id").eq("format", "banner");
  const fakeCompanies = ["Midlands Aero Components", "Precision Weld UK", "Northern Laser Services", "Clyde Fabrication", "Thames Estuary Marine", null, null, null, null, null];
  const events: Record<string, unknown>[] = [];
  for (let d = 90; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 864e5);
    const views = faker.number.int({ min: 40, max: 110 });
    for (let v = 0; v < views; v++) {
      const t = new Date(day.getTime() + faker.number.int({ min: 8, max: 20 }) * 3600e3);
      const story = faker.helpers.arrayElement(allPub!);
      const region = faker.helpers.arrayElement(UK_REGIONS);
      events.push({ occurred_at: t.toISOString(), kind: "story_view", story_id: story.id, member_id: story.member_id, region, session_hash: faker.string.alphanumeric(12) });
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
  await db.from("engagement_audit").insert(audit);

  console.log("— invoices, prefs, static pages, settings");
  await db.from("invoices").insert(memberLogins.flatMap((mid, i) =>
    Array.from({ length: 3 }, (_, k) => ({
      member_id: mid, number: `SMI-${2026}-${(i + 1) * 100 + k}`, amount_pennies: 4000,
      issued_on: iso(new Date(today.getFullYear(), today.getMonth() - k, 1)), status: k === 0 ? "issued" : "paid",
    }))
  ));
  await db.from("notification_prefs").insert(memberLogins.map((mid) => ({ member_id: mid })));
  // The join tests (unit + e2e) redeem these; without them the promo path only
  // works on a database an admin has hand-populated via /console/promo-codes.
  await db.from("promo_codes").insert([
    { code: "SMI-FREE-YEAR", months: 12, active: true },
    { code: "SMI-FREE-MONTH", months: 1, active: true },
  ]);
  // PostgREST bulk inserts need uniform keys across rows, so default the
  // per-row `collapsible` flag explicitly rather than omitting it.
  const pageRow = (p: { slug: string; title: string; body: string; collapsible?: boolean }) =>
    ({ collapsible: false, ...p });
  await db.from("static_pages").insert([
    ...AUTHORED_STATIC_PAGES, // real live-site copy (about, faq) — same rows seed-real.ts merges in
    { slug: "policies", title: "Policies", body: "<h2>Privacy</h2><p>Privacy policy.</p><h2>Cookies</h2><p>Cookie policy.</p>", collapsible: true },
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
  await db.from("settings").insert([
    { key: "grid", value: { blocks: 12, mix: { news: 6, video: 2, member_news: 2, featured_member: 1, featured_machine: 1 } } },
    { key: "social_caps", value: { per_day: 3, delay_minutes: 30 } },
  ]);
  // Lead-gen marks (GAPS A8.3). Refs are copied from the LeadGenSource mock's
  // fixtures rather than imported from it: the adapter pulls in src/lib/db/server,
  // which is `server-only` and can't be imported from a script.
  //
  // Admin marks only, deliberately. A member's visible prospects are a rotation
  // keyed on their member id, which is a uuid generated by this very seed run —
  // so a seeded member mark could easily point at a prospect outside that
  // member's window and render nothing at all. Better no row than a silent one.
  await db.from("prospect_marks").insert([
    { prospect_ref: "https://www.linkedin.com/company/pennine-press-brake-services", action: "call", member_id: null },
    { prospect_ref: "https://www.linkedin.com/company/calder-laser-cutting", action: "email", member_id: null },
    { prospect_ref: "https://www.linkedin.com/company/beresford-tooling", action: "sequence", member_id: null },
  ]);

  // One edited email template, not twenty-nine. `email_templates` is an
  // override table: a kind with no row here renders the copy shipped in
  // src/lib/email/defaults.ts, which is the normal state and the one the console
  // has to look right in. Seeding all of them would make "Customised" the
  // default badge on every row and hide the distinction the list page is built
  // around. This single partial row — subject changed, body left null — is here
  // so both states are visible, and so the visual baseline covers both.
  await db.from("email_templates").insert({
    kind: "welcome",
    family: "member",
    subject: "Welcome to Sheet Metal Industries — you're in",
  });

  const { DEFAULT_LAYOUTS } = await import("../src/lib/blocks/defaults");
  await db.from("page_layouts").insert(
    Object.entries(DEFAULT_LAYOUTS).map(([page_type, layout]) => ({ page_type, entity_id: null, layout })),
  );
  await db.from("jobs").insert({ kind: "newsletter_draft_reminder", payload: { month: iso(today).slice(0, 7) }, due_at: new Date().toISOString() });

  console.log("— dev board");
  await db.from("dev_tasks").insert([
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
  ]);

  console.log("Seed complete.");
  const counts = await Promise.all(
    ["members", "stories", "adverts", "contacts", "events", "videos"].map(async (t) => `${t}=${(await db.from(t).select("*", { count: "exact", head: true })).count}`)
  );
  console.log(counts.join(" "));
}

main().catch((e) => { console.error(e); process.exit(1); });
