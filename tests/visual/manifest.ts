/**
 * Every page this suite photographs.
 *
 * A typed module rather than JSON so `pnpm typecheck` catches a bad role or a
 * malformed entry, and so each pinned example can carry a note saying where it
 * came from.
 *
 * DYNAMIC ROUTES are pinned to one concrete example each. Those examples come
 * from the database as currently seeded — they are not guaranteed to survive a
 * reseed, and a pin that 404s is reported as an error rather than skipped, so it
 * gets repinned rather than quietly losing coverage.
 */

export type Role = "anon" | "member" | "admin";

export type Route = {
  /** Baseline filename. Changing it orphans the old baseline (accept.ts warns). */
  id: string;
  path: string;
  role: Role;
  /** Added on top of the defaults in lib/auth.ts. */
  cookies?: { name: string; value: string }[];
  /** Prefer a selector over a sleep. */
  waitFor?: { selector: string };
  /** Where a pinned example came from, so the next person can repin it. */
  pin?: string;
  /** Explicit, never silent. A skipped route is listed in every report. */
  skip?: string;
  /** Desktop (1280) unless set. The @phone copies below set "phone". */
  device?: "desktop" | "phone";
};

/** `/` -> home, `/console/adverts/banners` -> console_adverts_banners, `/search?q=x` -> search */
function idFor(path: string): string {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  return clean === "" ? "home" : clean.slice(1).replace(/\//g, "_");
}

const anon = (path: string, extra: Partial<Route> = {}): Route => ({ id: idFor(path), path, role: "anon", ...extra });
const member = (path: string, extra: Partial<Route> = {}): Route => ({ id: idFor(path), path, role: "member", ...extra });
const admin = (path: string, extra: Partial<Route> = {}): Route => ({ id: idFor(path), path, role: "admin", ...extra });

const PUBLIC: Route[] = [
  anon("/"),
  anon("/advertising"),
  anon("/contact"),
  anon("/event"),
  anon("/featured-machine"),
  anon("/join"),
  anon("/join/account"),
  // Bare /member is the tile list again (28 Oct); the word cloud is
  // ?view=cloud. The explicit id is mandatory on the cloud entry: idFor()
  // strips the query string, so the default would collide with `member` and
  // trip the duplicate guard at the foot of this file.
  anon("/member"),
  { id: "member_cloud", path: "/member?view=cloud", role: "anon" },
  anon("/news"),
  anon("/newsletters"),
  anon("/search?q=laser"),
  anon("/video"),

  // Outside the (public) route group but equally public.
  anon("/login"),
  anon("/reset"),
  anon("/unsubscribe"),

  // Captured as a member, not anonymously: the page is reached via /reset/confirm,
  // which has already exchanged the emailed token for a session, and it guards on
  // "is there a user" rather than on a token of its own (src/app/reset/new/page.tsx:23).
  // Anonymously it redirects to /login and there is nothing to photograph.
  member("/reset/new"),

  // No forge homepage route: while the design switcher is off the site serves
  // grid whatever the smi-theme cookie says (#33), so it would capture grid.
];

const PUBLIC_PINNED: Route[] = [
  anon("/news/t-level-scholars-secure-full-time-futures-at-steel-benders-uk", {
    id: "news_slug",
    pin: "first story on /news",
  }),
  anon("/member/amob-uk", { id: "member_slug", pin: "a real member from /member; the directory reshuffles daily so pick by name, not position" }),
  anon("/video/the-making-of-a-shufflebottom-building", { id: "video_slug", pin: "first video on /video" }),
  anon("/event/sheet-metal-industries-golf-challenge-2026", {
    id: "event_slug",
    pin: "hardcoded in the seed, so stable across reseeds",
  }),
  {
    id: "newsletters_slug",
    path: "/newsletters/issue-47",
    role: "anon",
    skip: "no newsletter issue exists in the current database — /newsletters lists none and issue-47 renders the not-found page. Unskip after a seed that creates one.",
  },
  anon("/industry/welding-joining", { id: "industry_slug", pin: "an industry from scripts/lib/industries.ts, inserted by migration 20261012000001" }),
  anon("/pages/about", { id: "pages_slug", pin: "authored static page (scripts/lib/static-page-content.ts)" }),
];

const DASHBOARD: Route[] = [
  member("/dashboard"),
  member("/dashboard/advertising"),
  member("/dashboard/advertising/buy"),
  member("/dashboard/advertising/manage"),
  member("/dashboard/advertising/assets"),
  member("/dashboard/billing"),
  member("/dashboard/equipment/new"),
  member("/dashboard/event/new"),
  member("/dashboard/help"),
  member("/dashboard/leads"),
  member("/dashboard/notifications"),
  member("/dashboard/pay"),
  member("/dashboard/profile"),
  member("/dashboard/resources"),
  member("/dashboard/settings"),
  member("/dashboard/settings/billing"),
  member("/dashboard/settings/security"),
  member("/dashboard/stats"),
  member("/dashboard/story/new"),
  member("/dashboard/submissions"),
  // The Live tab is where the page's new half lives — View and "Request a
  // change" only appear on published rows, and the All tab may have none.
  member("/dashboard/submissions?status=published", { id: "dashboard_submissions_live" }),
  member("/dashboard/video/new"),

  member("/dashboard/advert/852ffe1a-b8c6-4514-a89d-d739b5eb2929", {
    id: "dashboard_advert_id",
    pin: "member1's first booking (live KUKA banner; repinned 22 Oct, the old pin no longer existed after a reseed)",
  }),

  // member1 currently owns no submitted content, so the four editors have
  // nothing to open. Left here, visible and explained, rather than dropped —
  // they become capturable as soon as the member has a submission.
  {
    id: "dashboard_story_edit",
    path: "/dashboard/story/PIN/edit",
    role: "member",
    skip: "member1 has no submitted story in the current database — repin after a seed that creates one",
  },
  {
    id: "dashboard_video_edit",
    path: "/dashboard/video/PIN/edit",
    role: "member",
    skip: "member1 has no submitted video in the current database",
  },
  {
    id: "dashboard_event_edit",
    path: "/dashboard/event/PIN/edit",
    role: "member",
    skip: "member1 has no submitted event in the current database",
  },
  {
    id: "dashboard_equipment_edit",
    path: "/dashboard/equipment/PIN/edit",
    role: "member",
    skip: "member1 has no submitted machine in the current database",
  },
];

const CONSOLE: Route[] = [
  admin("/console"),
  admin("/console/analytics"),
  admin("/console/adverts"),
  admin("/console/adverts/artwork"),
  admin("/console/adverts/bundles"),
  admin("/console/adverts/featured-event"),
  admin("/console/adverts/featured-member"),
  admin("/console/adverts/interest"),
  // Was /console/adverts/spots ("Inventory") until fix-list 79; the old path
  // only redirects now. New id, so this needs a first human accept.
  admin("/console/adverts/banners"),
  // fix-list 78 — new route, no baseline yet.
  admin("/console/adverts/suppliers"),
  admin("/console/adverts/takeover"),
  // Site Config → Advertising page: the media pack and the public A–F format
  // cards, moved off the old Inventory page (now /console/adverts/banners).
  admin("/console/advertising"),
  admin("/console/categories"),
  admin("/console/industries"),
  admin("/console/content-pages"),
  admin("/console/crm"),
  admin("/console/dev"),
  admin("/console/email-templates"),
  admin("/console/events"),
  admin("/console/features"),
  admin("/console/social-reach"),
  admin("/console/leads"),
  admin("/console/machines"),
  admin("/console/media"),
  admin("/console/members"),
  admin("/console/notifications"),
  admin("/console/newsletter"),
  admin("/console/pages"),
  admin("/console/promo-codes"),
  admin("/console/releases"),
  admin("/console/resources"),
  admin("/console/stories"),
  // fix-list 75. Explicit id: idFor() strips the query and would collide with console_stories.
  { id: "console_stories_list", path: "/console/stories?view=list", role: "admin" },
  admin("/console/videos"),
];

/**
 * Ten console editors accept the literal `new` as their id, which makes the
 * empty-form state capturable without pinning to seeded data at all — the most
 * durable coverage in this manifest.
 */
const CONSOLE_NEW: Route[] = [
  admin("/console/stories/new"),
  admin("/console/videos/new"),
  admin("/console/events/new"),
  admin("/console/machines/new"),
  admin("/console/categories/new"),
  admin("/console/industries/new"),
  admin("/console/dev/new"),
  admin("/console/members/new"),
  admin("/console/content-pages/new"),
  admin("/console/adverts/artwork/new"),
  // /console/adverts/spots/new was the rate-card product editor, removed in fix-list 77.
];

const CONSOLE_PINNED: Route[] = [
  admin("/console/email-templates/welcome", {
    id: "console_email_template",
    pin: "the one row scripts/seed.ts customises, so this captures the edited state; every other kind renders the shipped default",
  }),
  admin("/console/adverts/7a80b0ba-0fde-4ba7-b041-d486e4f6b211", {
    id: "console_advert_id",
    pin: "member1's scheduled KUKA banner run (repinned 22 Oct: the old pin no longer existed after a reseed). The seed has no draft, so the A2.12 draft forms aren't in the picture",
  }),
  admin("/console/notifications/44894901-5d1a-4c72-9200-40ae867e4216", {
    id: "console_message_id",
    pin: "first thread on /console/notifications (the route was /console/messages until fix-list 71; the id is unchanged)",
  }),
  {
    id: "console_newsletter_id",
    path: "/console/newsletter/PIN",
    role: "admin",
    skip: "the newsletter index is empty in the current database — repin when an issue exists",
  },
  // fix-list 76/78 edit pages — new routes, no baselines yet.
  admin("/console/adverts/featured-member/4b350595-ab6a-4d62-8a20-f36c276fd117", {
    id: "console_featured_member_id",
    pin: "first slot on /console/adverts/featured-member",
  }),
  // Featured Event (HUMAN-TODO 4.4) — new route, no baseline yet.
  {
    id: "console_featured_event_id",
    path: "/console/adverts/featured-event/PIN",
    role: "admin",
    skip: "no Featured Event booking in the current database — repin after a reseed (scripts/seed.ts books one)",
  },
  {
    id: "console_takeover_id",
    path: "/console/adverts/takeover/PIN",
    role: "admin",
    skip: "no takeover in the current database — repin when one is booked",
  },
  admin("/console/adverts/banners/f98d4427-077b-4d91-b9c4-45b893ba3651", {
    id: "console_banner_run_id",
    pin: "the latest-ending banner run in the local seed (advert_bookings joined to adverts.format = banner, ends_on desc)",
  }),
  admin("/console/adverts/suppliers/3b9314bc-e2dd-4ed2-99d9-6ace54129ba6", {
    id: "console_supplier_logo_id",
    pin: "first row on /console/adverts/suppliers",
  }),
  {
    id: "console_bundle_id",
    path: "/console/adverts/bundles/PIN",
    role: "admin",
    skip: "no advert bundle in the current database",
  },
];

/**
 * Deliberately not captured:
 *   /[slug]                              legacy WordPress catch-all; only ever 308s or 404s
 *   /mock/stripe/checkout/[sessionId]    payment stub, session ids are ephemeral
 *   /go/[memberId], /visit/[id]          redirect handlers, no UI
 *   /reset/confirm                       route handler, no UI
 */
/**
 * #33: the public site and the member area again at phone width (390×844).
 * Grid drifted on phones unnoticed because every baseline was 1280 wide. The
 * console is left out on purpose — on a phone it only has to not scroll
 * sideways, which tests/e2e/mobile.spec.ts asserts on every route.
 * Run just these with `pnpm visual --only '*@phone'`.
 */
const PHONE: Route[] = [...PUBLIC, ...PUBLIC_PINNED, ...DASHBOARD].map((r) => ({
  ...r,
  id: `${r.id}@phone`,
  device: "phone",
}));

export const ROUTES: Route[] = [
  ...PUBLIC,
  ...PUBLIC_PINNED,
  ...DASHBOARD,
  ...CONSOLE,
  ...CONSOLE_NEW,
  ...CONSOLE_PINNED,
  ...PHONE,
];

/** Guards against a copy-paste that would silently overwrite another baseline. */
const seen = new Set<string>();
for (const r of ROUTES) {
  if (seen.has(r.id)) throw new Error(`visual: duplicate route id "${r.id}" in manifest.ts`);
  seen.add(r.id);
}
