/**
 * SMI local seed: ~25 real stories from the live site's public WP REST API
 * plus synthetic members, adverts, events, newsletters, contacts, analytics.
 *
 * Expects a fresh DB. Defaults to local; a hosted project needs --remote.
 * Run: pnpm exec tsx scripts/seed.ts [--remote]
 */
import { createClient } from "@supabase/supabase-js";
import { faker } from "@faker-js/faker";
import { svgBanner } from "./lib/placeholder-art";
import { assertSeedTarget } from "./lib/target-guard";

faker.seed(42);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:56321";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY not set (load .env.local)");
assertSeedTarget(SUPABASE_URL);
const db = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false } });

const WP = "https://sheetmetalindustries.com/wp-json/wp/v2";
const UK_REGIONS = ["West Midlands", "South Yorkshire", "Greater Manchester", "East Midlands", "South East", "North West", "Scotland", "Wales", "North East", "East of England"];
const MEMBER_CATEGORIES = ["Laser Cutting", "Fabrication", "Welding", "Tube Bending", "Press Brakes", "Machinery Sales", "Finishing & Coating", "Automation & Robotics", "Software", "Service & Maintenance"];

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

async function main() {
  console.log("— buckets");
  await db.storage.createBucket("media", { public: true }).catch(() => {});

  console.log("— categories (real story cats from WP + member cats)");
  const wpCats: { id: number; name: string; slug: string; count: number }[] = await fetch(
    `${WP}/categories?per_page=50&orderby=count&order=desc`
  ).then((r) => r.json());
  const storyCats = wpCats.filter((c) => c.count > 0).slice(0, 30);
  const catRows = [
    ...storyCats.map((c) => ({ kind: "story", slug: c.slug, name: decode(c.name) })),
    ...MEMBER_CATEGORIES.map((n) => ({ kind: "member", slug: slugify(n), name: n })),
  ];
  const { data: cats, error: catErr } = await db.from("categories").upsert(catRows, { onConflict: "kind,slug" }).select();
  if (catErr) throw catErr;
  const storyCatIds = cats!.filter((c) => c.kind === "story").map((c) => c.id);
  const memberCatIds = cats!.filter((c) => c.kind === "member").map((c) => c.id);
  const wpCatMap = new Map(storyCats.map((c) => [c.id, cats!.find((x) => x.kind === "story" && x.slug === c.slug)?.id]));

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
      category_id: faker.helpers.arrayElement(memberCatIds),
      description: faker.lorem.paragraphs(2),
      address: `${faker.location.streetAddress()}, ${faker.helpers.arrayElement(UK_REGIONS)}`,
      lat: faker.location.latitude({ min: 50.5, max: 55.5 }),
      lng: faker.location.longitude({ min: -4.5, max: 1.5 }),
      phone: faker.phone.number(),
      website: `https://www.${slugify(name)}.co.uk`,
      social: { linkedin: `company/${slugify(name)}`, x: slugify(name).slice(0, 15) },
      billing_mode: i % 10 === 0 ? "invoice" : "card",
      joined_at: faker.date.past({ years: 4 }).toISOString().slice(0, 10),
    };
  });
  const { data: members, error: memErr } = await db.from("members").insert(memberRows).select("id, slug, name, status");
  if (memErr) throw memErr;
  const activeMembers = members!.filter((m) => m.status === "active");

  console.log("— auth users (admin, media input-only, 3 member logins)");
  const mkUser = async (email: string, role: string, member_id: string | null, display_name: string) => {
    const { data, error } = await db.auth.admin.createUser({ email, password: "local-dev-password", email_confirm: true });
    if (error) throw error;
    await db.from("profiles").insert({ user_id: data.user.id, role, member_id, display_name });
    return data.user.id;
  };
  await mkUser("jas@smi.local", "super_admin", null, "Jas");
  await mkUser("media@smi.local", "input_only", null, "Media Co");
  const memberLogins: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = activeMembers[i];
    await mkUser(`member${i + 1}@smi.local`, "member", m.id, m.name);
    await db.from("members").update({ contact_email: `member${i + 1}@smi.local` }).eq("id", m.id);
    memberLogins.push(m.id);
  }

  console.log("— real stories from WP API");
  type WpPost = {
    slug: string; date: string; categories?: number[];
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
    storyRows.push({
      slug: slugify(p.slug),
      title: decode(stripTags(p.title.rendered)),
      excerpt: decode(stripTags(p.excerpt?.rendered ?? "")).slice(0, 300),
      body: p.content?.rendered ?? "",
      status: "published",
      source: "import",
      is_member_news: asMemberNews,
      member_id: asMemberNews ? faker.helpers.arrayElement(activeMembers).id : null,
      cover_path,
      published_at: p.date,
      wp_cats: (p.categories ?? []) as number[],
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
      is_member_news: p.is_member_news,
      scheduled_at: p.status === "scheduled" ? faker.date.soon({ days: 3 }).toISOString() : null,
    });
  }

  console.log("— advert slots, advertisers, banners, bookings");
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
  const palette = ["#1e3a5f", "#7c2d12", "#14532d", "#581c87", "#7f1d1d", "#0c4a6e", "#3f6212", "#701a75"];
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthsAhead = new Date(today); monthsAhead.setMonth(monthsAhead.getMonth() + 2);
  const monthsAgo = new Date(today); monthsAgo.setMonth(monthsAgo.getMonth() - 2);

  for (let i = 0; i < 8; i++) {
    const m = activeMembers[i + 3];
    const { data: adv } = await db.from("advertisers").insert({ name: m.name, member_id: m.id, contact_email: `sales@${slugify(m.name)}.co.uk` }).select("id").single();
    const dPath = await upload(`panels/panel-${i}-wide.svg`, svgBanner(m.name, 1280, 170, palette[i]), "image/svg+xml");
    const mPath = await upload(`panels/panel-${i}-narrow.svg`, svgBanner(m.name, 370, 280, palette[i]), "image/svg+xml");
    const { data: ad } = await db.from("adverts").insert({ advertiser_id: adv!.id, name: `${m.name} banner`, desktop_path: dPath, mobile_path: mPath, format: "banner" }).select("id").single();
    await db.from("advert_bookings").insert({ advert_id: ad!.id, starts_on: iso(monthsAgo), ends_on: i < 6 ? iso(monthsAhead) : iso(new Date(today.getTime() + 5 * 864e5)) }); // 2 expire within a week
  }
  for (let i = 0; i < 5; i++) {
    const m = activeMembers[i + 12];
    const { data: adv } = await db.from("advertisers").insert({ name: m.name, member_id: m.id }).select("id").single();
    const p = await upload(`panels/mark-${i}.svg`, svgBanner(m.name.split(" ")[0], 240, 120, palette[(i + 3) % 8]), "image/svg+xml");
    const { data: ad } = await db.from("adverts").insert({ advertiser_id: adv!.id, name: `${m.name} supplier logo`, desktop_path: p, mobile_path: p, format: "supplier_logo" }).select("id").single();
    await db.from("advert_bookings").insert({ advert_id: ad!.id, starts_on: iso(monthsAgo), ends_on: iso(monthsAhead) });
  }

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
    { slug: "smi-golf-challenge-2026", title: "SMI Golf Challenge 2026", location: "Belfry, West Midlands", starts_on: "2026-09-17", status: "published", description: "The annual SMI golf day." },
    { slug: "euroblech-2026", title: "EuroBLECH 2026", location: "Hanover, Germany", starts_on: "2026-10-20", ends_on: "2026-10-23", status: "published", link: "https://www.euroblech.com" },
    { slug: "open-house-bending-demo", title: "Open house: bending cell demo", location: faker.location.city(), starts_on: iso(new Date(today.getTime() + 30 * 864e5)), status: "awaiting_approval", member_id: memberLogins[0] },
  ]);
  const ytIds = ["fLcEcOuZTBs", "kXYiU_JCYtU", "hTWKbfoikeg", "9bZkp7q19f0", "dQw4w9WgXcQ", "L_jWHffIx5E"];
  await db.from("videos").insert(ytIds.map((v, i) => ({
    title: `${faker.company.buzzPhrase()} — shop floor tour`, url: `https://www.youtube.com/watch?v=${v}`,
    member_id: i < 3 ? activeMembers[i + 6].id : null, status: "published", source: i < 2 ? "manual" : "curated",
    published_at: faker.date.recent({ days: 60 }).toISOString(),
  })));

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
  await db.from("static_pages").insert([
    { slug: "about", title: "About SMI", body: "<p>The voice of the UK sheet metal, fabrication and welding trade since 2022.</p>" },
    { slug: "policies", title: "Policies", body: "<p>Privacy and cookie policy.</p>" },
    { slug: "advertising", title: "Advertise with SMI", body: "<p>Formats A–F, media pack available on request.</p>" },
    { slug: "mach-publication", title: "MACH Publication", body: "<p>Our MACH show magazine.</p>" },
  ]);
  await db.from("settings").insert([
    { key: "grid", value: { blocks: 12, mix: { news: 6, video: 2, member_news: 2, featured_member: 1, featured_machine: 1 } } },
    { key: "social_caps", value: { per_day: 3, delay_minutes: 30 } },
  ]);
  const { DEFAULT_LAYOUTS } = await import("../src/lib/blocks/defaults");
  await db.from("page_layouts").insert(
    Object.entries(DEFAULT_LAYOUTS).map(([page_type, layout]) => ({ page_type, entity_id: null, layout })),
  );
  await db.from("jobs").insert({ kind: "newsletter_draft_reminder", payload: { month: iso(today).slice(0, 7) }, due_at: new Date().toISOString() });

  console.log("Seed complete.");
  const counts = await Promise.all(
    ["members", "stories", "adverts", "contacts", "events", "videos"].map(async (t) => `${t}=${(await db.from(t).select("*", { count: "exact", head: true })).count}`)
  );
  console.log(counts.join(" "));
}

main().catch((e) => { console.error(e); process.exit(1); });
