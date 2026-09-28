# Implementation gaps — Phase 1

Audited 31 Aug 2026 and reconciled 1 Sep. **Re-reconciled 27 Sep 2026** against the 18 Sep call, as written into [`USE-CASES.md`](../../requirements/USE-CASES.md) open-gaps rows 19–26 and the `[18 Sep]` lines of [`REQUIREMENTS.md`](../../REQUIREMENTS.md). The audit covers 70 use cases: V1–V18 + V11b, M1–M14, A1–A29, S1–S8.

**Part A** can be built today with no external account or key. **Part B** needs a third-party service wired. **Part C** covers honesty fixes owed because Part B is unfinished.

Every item is numbered so it can be referenced directly, for example "do A2.1 and A2.2". Tick items as they land and add the commit SHA next to each ticked item.

**Closed items are tombstoned.** Each section ends with a one-line index of its closed IDs. The full write-ups (what was built, trade-offs, what was found en route) are in git: `git show 320e28e:docs/GAPS.md`. Numbers are permanent and never reused, because code comments, tests and migrations cite them. When an item closes, move it into its section's **Closed** line.

When an item is *coded but inert* pending an account, key or approval, the human step is in **[`HUMAN-TODO.md`](HUMAN-TODO.md)**. Open client questions are in **[`ask-jas.md`](ask-jas.md)**. Feature-parity scoping for the member area is in **[`legacy-members-admin-inventory.md`](legacy-members-admin-inventory.md)**.

---

## Part A — Buildable now, no third-party dependency

### A1 · Content & CMS CRUD

- [ ] **A1.5 (residual) — Specs for advertising formats B/C/D/F are still blank.** The copy is editable at `/console/advertising`, but no real dimensions were available to enter, and nobody should invent them. Someone who owns the rate card has to fill them in. → `src/app/(public)/advertising/page.tsx`
- [x] **A1.7 — The homepage grid mix is not configurable (A13).** The block editor has no `home` page type, and the section mix is hardcoded in `home.forge.tsx` / `home.grid.tsx` / `home.data.ts`. Slot caps, the other half of A13, do work. → `src/lib/blocks/schema.ts:1`
  **Deliberately held:** a narrow "reorder the bottom sections" mechanism (safe for ad slots) was scoped but is parked pending the homepage wireframe discussion. The grid homepage has since been reshaped by hand through fix-list 61–68.
  **Fixed (28 Sep), as that narrow mechanism, grid design only:**
  - A "Homepage sections" card on `/console/pages` sets the **order and visibility** of the five editorial sections below the fold: videos + Featured Members box, member news, supplier logos, events, newsletters. The setting is `settings.home_sections`; the model is `src/lib/home-sections.ts` (pure, tested).
  - **Ad-slot safe by construction:** the fold is fixed, and the banners are not sections. `home_1` follows the fold, `home_2` the first section that actually renders, and `home_3` the last, so banners always sit between content. With one section left, `home_3` drops below the stats band rather than touching `home_2`.
  - **Paid sections can move but never be hidden:** the Featured Members box and the supplier logo wall. `resolveHomeSections` enforces this even against a crafted POST.
  - Up/down buttons work with no JavaScript. A stored layout is always resolved to a complete, valid one, so a bad row can't blank the homepage, and the default reproduces the page exactly (the existing advert-inventory test still passes).
  - **Verified live:** reordered and hid a section as Jas, and the homepage followed; deleting the setting restored the default.
  - **En route:** the block editor's list is now named "Page blocks", and `flows.spec.ts` is scoped to it, because the new card's "Move … up" buttons came first on the page.

  **Not done:** per-section item counts (A13's "how many news/video…"). The rows are three-column grids, and arbitrary counts leave ragged rows. Forge is not configurable. *(Working tree, uncommitted.)*
- [x] **A1.12 — A member page edit raises no console notification (fix-list 71).** Every other member submission writes an `inbox_messages` notification that links to the item. A revision to a live page does not: `submitProfileEdit` inserts into `member_revisions` and redirects without notifying. Only a draft's *first* submit notifies (`page_submitted`). The `inbox_messages_kind_check` constraint in `20260923000001` has no value for revisions. Revisions still surface in "Quick approvals" and on the member's console page, so this is a consistency gap, not a lost queue. The fix is one idempotent migration that adds the kind, plus a notify call. → `supabase/migrations/20260923000001_inbox_categories.sql:44`, `src/app/dashboard/actions.ts:367` (`submitProfileEdit`, revision insert ~`:444`)
  **Fixed (28 Sep):** migration `20260928000005_inbox_page_edit_kind.sql` re-creates the kind check with one addition, `page_edit_submitted`. `submitProfileEdit`'s live-page branch now raises it. It is labelled "Page edit" and links to the member's console record, where the pending edit's Approve/Reject already are. The notifications page's filter chips pick the kind up automatically. A draft's first submit stays `page_submitted`. Tests cover both branches and the link. *(Working tree, uncommitted — migration applied locally.)*

**Closed:** A1.1 console cover upload · A1.2 cover crop applied at every render site · A1.3 category CRUD · A1.4 media library · A1.5 advertising format copy editable (residual above) · A1.6 static-page layouts save · A1.8 event types · A1.9 console inbox · A1.10 kanban drag, stories and events · A1.11 member story library uncapped.

### A2 · Advert & inventory management

**Closed:** A2.1 homepage takeover (was already built) · A2.2 featured-member booking · A2.3 bundles UI · A2.4 newsletter advert slots · A2.5 members see all their adverts · A2.6 visibility confirm raises an invoice · A2.7 invoicing on approval · A2.8 `news_mid` renders unconditionally · A2.9 `mpu` mobile artwork · A2.10 random one-of-three per load (in-page carousel still Jas's call, HUMAN-TODO §5.4) · A2.11 migration `set not null` guard.

### A3 · Publishing pipeline & scheduling

- [ ] **A3.1 — Production cron runs once a day at 03:00**, while `src/lib/jobs.ts` assumes ticks every minute (`publish_scheduled` every 60s). Scheduled stories publish up to 24h late, the "~30 min later" social push lands at the next 03:00, and a newsletter scheduled for 10:00 sends the next morning. This degrades A6, S3 and every scheduled send. → `vercel.json`
  **Deferred (31 Aug 2026)** — not live yet, and a tighter cron means more invocations. Revisit before launch. The fix is one line.
  **Held again 28 Sep:** the SMI Vercel plan is unconfirmed, and Hobby allows only one cron run a day. A more frequent schedule would make deploys fail there. It stays daily until the plan is confirmed (HUMAN-TODO 13.1 has the options: every minute or hourly, both needing Pro).

**Closed:** A3.2 video pinning · A3.3 admin-set pin duration · A3.4 approve-then-schedule · A3.5 overflow spacing for social pushes · A3.6 real story preview · A3.7 `social_caps` editor.

### A4 · Member area

- [ ] **A4.12 (residual) — Members cannot change their login email.** Password change shipped. Change-email needs Supabase's double-opt-in `email_change` flow: a new callback route distinct from `reset/confirm`'s `recovery` type, plus copy separating login email from `contact_email`. → `src/app/dashboard/settings/page.tsx`
  **Built 28 Sep, not yet verified end to end, so still open:**
  - A "Login email" section on `/dashboard/settings/security`. It shows the current login email and says it is not the company page's contact email.
  - `changeLoginEmail` validates, refuses the current address, rate-limits to 3 an hour per account, and calls `updateUser({ email }, { emailRedirectTo: …/account/email/confirm })`.
  - The new callback route `/account/email/confirm` sits outside `/dashboard`, because the old address's email is often opened on a device with no session. It hardcodes the `email_change` OTP type and accepts `token_hash` or a PKCE `code`, the same shape as `/reset/confirm`. The login page has a readable expired-link message.
  - Unit-tested (6 tests).

  **Why not verified:** the running local auth server has **stale config**: `GOTRUE_SITE_URL=http://127.0.0.1:3000` and an allow-list of only `https://127.0.0.1:3000`, while `config.toml` says 3100. Every redirect to the app is rejected and falls back to a dead port. That also breaks **local password-reset links**, and predates this work. A simulated run through Mailpit, handing each link's code to the callback by hand, showed two things that need a real check:
  1. The change applied after **one** link (the old address's), although secure email change reports on. The page copy was rewritten to promise neither "one" nor "both".
  2. After the callback the member was sent to login rather than back to Settings.

  Both may be artifacts of the stale config and the hand simulation; unconfirmed either way. HUMAN-TODO 19.5 (restart local Supabase) and 19.6 (hosted settings) have to come first, then an end-to-end check. → `src/app/dashboard/actions.ts` (`changeLoginEmail`), `src/app/account/email/confirm/route.ts`

**Closed:** A4.1 password reset · A4.2 stats/lead digest jobs · A4.3 grace → lapsed sweep · A4.4 lapsed members' backlinks hidden (hide vs unpublish still to confirm, HUMAN-TODO §5.5) · A4.5 address geocoding (testimonials since removed product-wide) · A4.6 page-edit approvals notify, with reason · A4.7 invoice PDFs in a private bucket · A4.8 never-posted nudge · A4.9 signup collects phone/website/address · A4.10 notification labels · A4.11 promo codes · A4.12 change password (email: residual above) · A4.13 member-editable industry · A4.14 member-editable `contact_email` · A4.15 notifications feed · A4.16 resources library (empty until assets are uploaded) · A4.17 edit/withdraw before approval · A4.18 welcome panel.

### A5 · Reporting & analytics surfaces

**Closed:** A5.1 search queries logged · A5.2 search report · A5.3 `/console/analytics` · A5.4 newsletter sends/opens/clicks (webhook shape unverified until a live Resend send) · A5.5 month-by-month member stats · A5.6 outbound website clicks · A5.7 newsletter stats corrected · A5.8 member activity timeline · A5.9 CRM search + site activity · A5.10 phone/email/social click tracking.

### A6 · Public site compliance & polish

**Closed:** A6.1 "Oldest" sort removed · A6.2 mobile nav · A6.3 Advertising under Media · A6.4 directory map view · A6.5 logo-led directory (the word-map default since 18 Sep is with Jas, ask-jas §7) · A6.6 pagination on directory/video/event/search · A6.7 search bar on home/news/video · A6.8 member-stories-only search filter · A6.9 member videos badged · A6.10 videos woven into /news · A6.11 cookie-settings link · A6.12 `link_url` override is as specified · A6.13 join CTA on /advertising.

### A7 · Platform & admin

**Closed:** A7.1 two roles is the intended model · A7.2 revenue from the live rate card · A7.3 member ownership helpers · A7.4 silent `saveLayout` no-ops · A7.5 stalled-cron warning.

### A8 · New requirements from the 31 Aug refresh

- [x] **A8.1 — Members cannot set their own membership types (V8 / V13 / M5).** The fixed list, the `member_membership_types` join table, console assignment and the `/member` filter all exist (migration `20260904000001`). So does member-facing Services editing (fix-list 42/43/52, via the shared `CompanyPageForm`).
  **Reopened as a build item, 27 Sep:** the 13 Sep decision to keep membership types read-only for members is **reversed** by the 18 Sep call (USE-CASES gap 21, REQUIREMENTS §6). Members must be able to edit their own types, multi-select, **capped at 6**. Today `CompanyPageForm` renders checkboxes only when `isConsole` and tells members "Set by SMI; contact us to change it". `/join` step 1 (`AccountForm.tsx`) has no picker. The only writer is the console action, and no 6-cap is enforced anywhere (form, action or schema). Members' type changes should ride the revision payload the way `service_ids` already does, so they stay approval-gated.
  Separately, there is still no console screen for the Services **vocabulary** (add/rename/remove terms). Nothing in Phase 1 asks for it. → `src/components/member/CompanyPageForm.tsx:94-98`, `src/app/(public)/join/account/AccountForm.tsx`, `src/app/console/actions.ts` (`decideRevision`), `src/lib/membership.ts` (`provisionMember`)
  **Fixed (28 Sep):**
  - `CompanyPageForm` renders the membership-type checkboxes for members too, so `mode` no longer gates them.
  - A **draft** member's pick applies on save. A **live** member's pick rides the revision as `membership_type_ids`, exactly like `service_ids`, so it is approval-gated. `decideRevision` treats a missing key as "leave alone", so revisions written before today can't wipe types Jas assigned.
  - `/join` step 1 has the same picker (optional). `provisionMember` writes the picks, and a failure there is logged rather than undoing a created account.
  - The **cap of 6** lives in one place, `replaceMemberMembershipTypes` / `membershipTypesError` in `src/lib/member-services.ts`, used by all four write paths (console editor, member save, revision approval, signup). In `decideRevision` it is checked *before* any write, so an over-cap revision can't half-apply. There are only five types today, so an honest form can't reach the cap: it guards tampered POSTs and a growing vocabulary. There is no DB constraint, because a check constraint can't count rows and the repo has no triggers.
  - `membershipTypes()` now also selects `id`.
  - Tests cover revision apply/absent/over-cap, member live/draft/over-cap, console replace/over-cap, and join pass-through/over-cap. *(Working tree, uncommitted.)*
  **Found, and fixed 28 Sep:** `tests/e2e/join.spec.ts` "promo path" couldn't pass on this machine's database, for two reasons unrelated to this item. (1) The local DB was seeded with `seed-real.ts`, which creates no `promo_codes`, so `SMI-FREE-YEAR` is refused as "Unknown promo code" (`seed.ts` creates it). With the code added temporarily, the test passes signup, the draft page submit and activation. (2) It then fails at `:102`: it expects the signup trail on the Command Centre inbox, which fix-list 71 (23 Sep) made messages-only. The test predates that (last touched 3 Sep). Now the test **creates its own unique promo code** through `/console/promo-codes` as Jas, so it no longer depends on which seed ran, and it asserts the 3 funnel entries on `/console/notifications?category=notification`. It passes. Each run leaves one `E2E-YEAR-…` code behind, as it already leaves its test account. `console-members.spec.ts` passes in full.
- [x] **A8.2 — There is no site-wide homepage-variant toggle (A28).** `siteVariant()` reads only the requesting browser's `smi-theme` cookie. The admin switcher (in the console header, and on every route since fix-list 62) flips only the admin's own cookie. The fix is a site-wide default in `settings` that `siteVariant()` falls back to, plus a console control. → `src/lib/variant.ts`, `src/components/ThemeSwitcher.tsx`
  **Fixed (28 Sep):**
  - A new `settings.site_variant` row holds the design every visitor gets. `siteVariant()` resolves in this order: the browser's own `smi-theme` cookie if it names a design (the admin switcher, now a *preview*), then the site default, then forge. Forge is also what the site gets when the row is missing or the read throws, so a settings hiccup can't take the site down.
  - Retired cookie values (`live`/`demo`) now fall through to the site default instead of being forced to forge.
  - **Found en route:** the root layout read the cookie itself to stamp `<html data-theme>`, so on a grid default it would have stamped forge over a grid page. It now calls `siteVariant()` too.
  - **Console:** a "Homepage design" card on `/console/pages` (`saveSiteVariant`) that saves for every visitor and revalidates `/` as a layout. If the admin's own browser holds a switcher cookie that differs, the card says so and offers "Show me what visitors see" (`clearMyVariantOverride`).
  - **Cost:** one small `settings` read per request that has no cookie, deduplicated per render by `cache()`.
  - **Verified in the running app** with the row set and then removed: no cookie → grid (both `data-theme` and the grid header in the body), a forge cookie still wins, a retired cookie → grid, and forge again once the row is gone.
  - Tests are in `variant.test.ts` and `console-actions-stories.test.ts`. *(Working tree, uncommitted.)*

  **Found, and fixed 28 Sep:** `tests/e2e/flows.spec.ts:372` ("admin block layouts") had failed since `97975e6` (25 Sep). The story save now lands on `…?saved=1` and the test's `/[0-9a-f-]+$/` rejects it. The wait now accepts `?saved=1` and the story id is read from the URL's path. The whole test passes, including the per-story override half it never reached before.
  **That half had its own latent flake, fixed with it:** the clean-up click ("Remove this page") was the test's last line and nothing waited for it, so a run could end before the server action ran and leave the override behind. The next run could then pick that leftover story as its "normal story with adverts" and fail. Four such overrides had piled up locally, one from about 22 Sep. The test now waits for "currently using the default", and picks its comparison story from outside the "E2E layout" set. The leftover override rows were deleted (test stories only). Two back-to-back runs pass and leave nothing behind.
- [ ] **A8.3 — Admin lead-generation panel (A29): partial.** Built: the mock `LeadGenSource` adapter, `/console/leads` with search criteria, and call/email/sequence marks (`prospect_marks`). **Missing, per the 18 Sep guardrails** (USE-CASES gap 24, TECH-DECISIONS #16):
  - **Prominent job titles.** The `Prospect` type has no title field.
  - **A mandatory disclaimer** saying these are not vetted sales leads, only people whose own public data or engagement matched. Today there is only a "Sample data" banner.

  **Blocked on Jas's sign-off of the exact disclaimer wording**, even as a mock. → `src/lib/adapters/leadgen.ts:32`, `src/app/console/leads/page.tsx:55`
  **Built 28 Sep, awaiting that sign-off:** `Prospect` has a `jobTitle` and every sample prospect carries one. It is shown bold on both panels: first line of the console's Contact column, and under the company name on the member card. A shared `LeadsDisclaimer` (`src/components/leads/LeadsDisclaimer.tsx`) sits under the "Sample data" banner on both pages, so the wording lives in one place and the panels can't diverge. The text is **draft** and quoted in `ask-jas.md` §15. It stays open until he answers. Tests: `leadgen-adapter.test.ts` (every prospect has a title) and `leads-disclaimer.test.tsx`. *(Working tree, uncommitted.)*
- [ ] **A8.4 — Member lead-generation panel (M14): partial.** `/dashboard/leads` exists on the same adapter, with the same two gaps and the same block as A8.3. → `src/app/dashboard/leads/page.tsx:26`
  **Correction (28 Sep):** "`lead_alert` still has no link target, waiting on this panel" was wrong. `lead_alert` counts `engagement_audit` rows (real companies engaging with the member's page, M7/M9), not the mock prospects shown here. It now links to `/dashboard/stats` in the notification feed, which is where its email's button already went. *(Working tree, uncommitted.)*
  **Found and not fixed:** the lead-alert email says "See who's interested in your member area", but the "Who's engaging" list left `/dashboard/stats` in the 8 Sep rework (A5.5/A5.7). Today no member-facing page shows *which* companies engaged; the list exists only in the console. Either bring a company/region list back to the member area, or reword the email. That is a product call. → `src/lib/email/defaults.ts:500`
- [x] **A8.5 — A member page can only show one company video (fix-list 15).** `members.video_url` is a single column. A carousel needs a `member_videos` table (member_id, url, sort_order), multi-entry UI in `CompanyPageForm`, and a carousel branch on the public page's `profile_video` block. → `src/lib/queries.ts` (`memberBySlug`), `src/app/(public)/member/[slug]/page.tsx`
  **Fixed (28 Sep), with no new table (plan Q1 default):**
  - The member page plays the company video (`video_url`) first, then the member's own **published** SMI videos from the existing `videos` table, which are already approval-gated. `memberBySlug` fetches the newest 12 alongside the stories. The pure `memberVideoList()` (`src/lib/member-videos.ts`) orders the list, de-duplicates by YouTube id, and drops unreadable links.
  - `MemberVideos` shows **one** player and a row of title buttons plus previous/next. It is not an auto-advancing carousel: rotating embedded players would pull a video from under someone about to press play, and would need a WCAG 2.2.2 pause control. Only the selected video loads an iframe. The selection says "Playing:", so it isn't marked by colour alone.
  - Verified live on a member with a company video and two SMI videos: "1 of 3", one player.
  - **Also:** the company-page `video_url` is now YouTube-only in the shared parser (`companyPageValuesFromForm`), closing A9.10's "not done". One local row fails the new rule: `5s-technologies-ltd` has a YouTube *channel* link that never played. Whoever next saves that page is asked to fix or clear it.

  **Found, and fixed 28 Sep (below):** the site CSP's `img-src` did not allow `https://i.ytimg.com`, so YouTube stills never load in the browser. That is why the picker uses titles, not thumbnails. It is also a latent bug in the existing cards: `VideoCard`, the grid video card and the home hero all fall back to an ytimg still when a video has no uploaded thumbnail, and that fallback is blocked. It rarely shows, because 386 of 387 seeded rows have an upload. **Fixed:** `https://i.ytimg.com` is added to `img-src` (images only, a named host, no wildcard). The new `tests/unit/csp.test.ts` is the first test of the security headers at all: it pins that host and asserts `img-src` never gains `*` or a bare scheme. Verified in a browser after a dev restart: a still loads with no `securitypolicyviolation`. The member-video picker keeps titles by choice. → `next.config.ts:44` *(Working tree, uncommitted.)*

### A9 · New requirements from the 18 Sep call (USE-CASES gaps 19–26, REQUIREMENTS `[18 Sep]`)

Already done from this call, so no item: Industries pre-filter (gap 19; `industries` table since 10 Sep, `?industry=` on news/video/event/member, industries bar below the nav on grid) · event location + type (fix-list/A1.8) · in-dashboard help to Jas (`/dashboard/help`) · dropped card dates, bigger featured-member logos, "Become a Member" on the stats band, three-column grid fold with separated Featured Machine/Event (fix-list 64–68) · ad-format freeze (gap 25; `banner_narrow` hidden, fix-list 74) · reset-only password recovery (gap 22).

- [x] **A9.1 — Picking a membership type on /member doesn't narrow the list beneath it (gap 20, confirmed bug).** Services, Membership type and the Industry pills are independent filters, each always listing every option. Choosing a type narrows only the *results*. The schema has no type → service (or type → industry) mapping, so a narrowing fix needs that mapping defined first. Its contents are a data question for Jas, not something to infer. → `src/app/(public)/member/page.tsx:149-169`, `src/lib/queries.ts` (`memberFilterIds`)
  **Fixed (28 Sep), by faceting rather than a mapping.** An option stays on offer only if at least one member matching the *other* filters actually has it. Each axis is faceted against the others only, because within an axis the filter is OR and ticking a second option must stay possible. A selected option is always kept, even at zero matches, so it can be unticked. This needed nothing from Jas: `scripts/lib/industry-map.ts` is a dev-only guess and was not used.
  - The pure rule is `computeFacets` / `narrowOptions` in the new `src/lib/member-facets.ts` (tested).
  - The loader is `memberFacets()` in `queries.ts`. It uses the same visibility and keyword match as `memberDirectory` and returns null when nothing is filtered, so the landing page costs no extra reads. The join tables are read through a new paged `allRows()`, because PostgREST caps responses at `max_rows = 1000` and would otherwise truncate silently as members × services grows (163 links today).
  - Verified in the running app: "Equipment Supplier" narrows Services 69 → 28 and Industries 10 → 7. "Software", which no member holds yet, offers none instead of 69 dead ends.

  **Not changed:** with nothing selected, every option is still listed, including a type no member holds. *(Working tree, uncommitted.)*
- [x] **A9.2 — "Content reach" chart (Gap 6, 18 Sep direction).** The direction is to combine all-time reach across adverts, stories, videos and social shares into one overall figure, broken out by content type. `/dashboard/stats` still shows a standalone single-series "Story reach". The social-share half has no data source yet (see D5). → `src/app/dashboard/stats/page.tsx:148`
  **Fixed (28 Sep), minus social (plan Q5 default):**
  - "Story reach" is now **Content reach**: an all-time headline plus a per-type breakdown (Adverts = page impressions + newsletter opens, the same definition as the Advert impressions chart; Stories; Videos), and a 12-month `StackedTrendChart` split the same way. The totals are exact head counts, so they aren't truncated at `max_rows`.
  - Video views were never attributable, so migration `20260928000003_video_view_event.sql` adds a `video_view` event kind. The video page records it with the video's `member_id`, alongside the unchanged site-wide `page_view`. The nightly rollup already groups every kind by member, so it needed **no** change. History can't be recovered, and the card says video views count from 28 Sep.
  - **Social shares are left out, not shown as zero,** until D5 decides how to count them. The card says so.
  - Pure helpers are in `src/lib/content-reach.ts` (tested).
  - **Verified live:** consented visit → one `video_view` for the right member, unconsented → none. With marked synthetic rows, the card read "5 · Stories 3 · Videos 2"; rows deleted afterwards.
  - **Production:** the migration needs pushing (HUMAN-TODO 19.4). Until then, `video_view` inserts fail the check constraint and are logged and dropped. They are recorded in their **own** `record()` call, because `record()` inserts a batch as one statement and a shared batch would also have lost the page's site-wide `page_view`.

  **Found, and fixed 28 Sep (below):** the same page read a year of raw `ad_impression` rows, and of click rows, with **no** paging. Past PostgREST's `max_rows` (1000), the Advert impressions and Clicks overview charts and the 30-day impressions tile would **silently under-count** for a busy advertiser. That's the failure `jobs.ts:496` warns about. It predates this pass. **Fixed:**
  - New migration `20260928000004_member_event_months.sql` adds `member_event_months(member, since)`. It counts impressions (by location) and clicks (by kind) per UTC month **in SQL**, returning at most ~100 rows whatever the traffic. It keeps the page's exact bucketing rules. It is service-role only; anon and authenticated are refused (checked).
  - The 30-day tiles are exact head counts.
  - The same bug in the **story-reach trend** (one `rollups_daily` row per story per day, ~3,650 a year for ten stories) is fixed with the shared paged reader, now `src/lib/db/all-rows.ts`.
  - **Verified** with 1,500 marked synthetic impressions plus 7 clicks for one member: the function returned 1,500; the page's tile, the Advert impressions chart ("Other pages 1,500"), Content reach and Clicks overview ("Website 7") all matched. Rows deleted afterwards.
  - **Production:** HUMAN-TODO 19.4. Without the migration the stats charts read empty, because the RPC call fails and is treated as no rows. → `src/app/dashboard/stats/page.tsx` *(Working tree, uncommitted.)*
- [x] **A9.3 — Member News belongs in the top rotating carousel, not only at the foot of the page (REQUIREMENTS §3).** It should be tagged "Member News" and rotate on refresh, with the fuller list kept lower down as a secondary destination.
  - **Grid:** there is no hero, and member news is a band near the bottom.
  - **Forge:** the hero labels a member story only when one happens to be among the newest. No slot is reserved.

  → `src/app/(public)/home.grid.tsx:176`, `src/lib/hero.ts:118`
  **Fixed for grid (28 Sep; plan Q2 assumes grid goes live, asked in ask-jas §17):** the new pure `weaveMemberNews()` (`src/lib/member-news-weave.ts`) rotates member stories into the More News carousel at the 2nd and 5th tiles, where the existing `MemberBadge` tags them. Its rules:
  - **Share:** at most 2 member stories in the 10-story fold, counting any already there by recency (REQUIREMENTS §7's ≤20%).
  - **Rotation:** a fair shuffle **per request**, so every member gets turns and the story changes on refresh.
  - **Order:** the carousel still opens on the newest industry story, and weaving pushes out only the *oldest* industry tiles, which are still on `/news`.
  - The "Featured member news" band lower down stays and skips whatever the carousel used.
  - Verified live: 8 tiles, 2 badged, different member stories across three loads. Tests are in `member-news-weave.test.ts` and `home-grid.test.tsx`, where the industry run stays a gap-free prefix.

  **Not done:** forge (its hero only labels member news by chance). Only worth doing if Jas says forge is staying. *(Working tree, uncommitted.)*
- [x] **A9.4 — The Featured Machine page can't carry a video (REQUIREMENTS §3, advertiser feedback).** `featured_machines` has no video column. This needs a migration, the field on the console/member forms, and an embed on the page alongside image, text and brand logo. REQUIREMENTS suggests the member's advertising "assets" tab as its natural home (A9.8). → `src/lib/db/types.ts:1009`, `src/app/(public)/featured-machine/page.tsx`
  **Fixed (28 Sep):**
  - Migration `20260928000002_featured_machine_video.sql` adds a nullable `featured_machines.video_url`, with no backfill.
  - An optional YouTube field (`YoutubePreview` with `required={false}`, live preview) is on the console editor and on the member's add and edit forms. `saveMachine`, `submitMachine` and `editMachine` validate it through the new `optionalYoutubeUrl()`: blank means no video, and a non-YouTube link is refused with a readable error before the photo uploads. `/dashboard/equipment/new` gained the error banner it lacked.
  - The public page embeds it (youtube-nocookie) above the description.
  - It also shows the **seller's logo** beside "Offered by", since the same 18 Sep line lists "picture/text/brand logo" and the page had no logo. `activePlacements` now selects `video_url` and the seller's `logo_path`.
  - Verified in the running app on the featured listing, then reset to null.
  - The "assets tab" home for this video is A9.8.
  - **Production:** the migration must ship **with** the code (HUMAN-TODO 19.4). `activePlacements()` swallows query errors, so a deploy that runs ahead of it silently empties every paid placement. That swallowing is the same pre-existing pattern fix-list 70 left alone on the public site; not changed here. *(Working tree, uncommitted.)*
- [x] **A9.5 — Search misses members by industry, category or service (REQUIREMENTS §4, "free-text keyword search… anything").** `members.search_tsv` is generated from `name` + `description` only, so searching a service term finds no member that merely offers it. Widening the generated column is a migration, and the services terms live in a join table, which a generated column can't read. → `supabase/migrations/20260808000004_search_rls.sql:12-16`, `src/lib/queries.ts` (`searchSite`)
  **Fixed (28 Sep):** new migration `20260928000001_search_members.sql` adds `search_members(query, max_results)`, a `language sql stable` function. It matches `search_tsv` **or** the member's service names **or** their industry name (weighted C, below name A and description B), and returns results in `ts_rank` order; before, member results had no order at all. `searchSite` calls it through `.rpc()`. Stories are unchanged.
  - **Why a function and not a column:** a generated column can't read the join table, and a trigger-kept column would be the repo's first trigger.
  - **Permissions:** `security invoker`, so anon still goes through `public_read_active_members`. It was tested in a rolled-back transaction: an archived member drops out as anon. Execute is granted explicitly to anon/authenticated/service_role, after a revoke from public.
  - **Measured locally, member matches before → after:** "oxyfuel" 0 → 14, "waterjet" 1 → 14, "guillotines" 1 → 11, "punching" 5 → 13. `/search` shows the first 10.
  - `db/types.ts` was regenerated; the diff is only the new function.
  - **Production:** needs the migration pushed (HUMAN-TODO 19.4). Until then `/search` there returns no members at all, because the RPC is missing, but it doesn't error, since the result falls back to `[]`. **Deploy the code and the migration together.** *(Working tree, uncommitted — migration applied locally with `supabase migration up`, no reset.)*
- [x] **A9.6 — FAQ and Policies structure (REQUIREMENTS §3).**
  - **FAQ:** the FAQ should be expanded, with groupings for News, Members and Events. Today it is a flat run of `<h2>` questions. The collapse code already supports two levels, so this is content work. The FAQ is already console-editable.
  - **Membership policy:** there is none. `membership-terms` exists but isn't linked from the footer.
  - **Accordion:** Policies should use the FAQ's accordion. The real-data seed defaults every page to `collapsible: false` and only the FAQ opts in.

  → `scripts/lib/static-page-content.ts`, `scripts/seed-real.ts:979`, `src/components/GridSiteFooter.tsx`

  **Fixed:**
  - **FAQ:** grouped into Membership / News / Members / Events / Advertising / Account and billing, as h2 topics over h3 questions. The existing two-level collapse renders this with no code change. The 17 existing answers are kept word for word; 7 new ones cover News, Members and Events, each written against checked behaviour.
  - **Policies and Membership terms:** both are now `collapsible: true`. Because `seed-real.ts` defaults the flag to false, this is the only way to keep it set across reseeds.
  - **Membership policy:** that page is `membership-terms`, which now has its own footer row in both designs.
  - New `tests/unit/static-page-content.test.ts` checks the grouping, that sanitisation keeps every question, that the collapse renders every group and question, and that the FAQ carries no `[SMI TO CONFIRM]`.

  **Found and fixed en route:** `scripts/seed.ts` inserted `policies` twice, once from `AUTHORED_STATIC_PAGES` and once as a stub. That duplicated the primary key in one bulk insert, and the unchecked insert dropped **every** static page from a `pnpm seed` run. The stub is gone, the insert now throws on error, and the new test asserts that authored slugs are unique.

  **Not done:** the FAQ's quarterly-stats line waits on A9.7. Production needs the `--pages-only` run (HUMAN-TODO 19.1). Visual baselines have moved (19.3). *(Working tree, uncommitted.)*
- [ ] **A9.11 — Nothing on the public site offers a member's email any more (V8).** V8 has readers contact a company "via website link, phone, or email", and `/go/[memberId]` still handles `kind=email` and counts `email_click` for member stats. But no page renders that link. The company page shows Website, Call and social links only. The directory card's Email link was removed in `97af6de`, the fix-list pass that simplified the cards. That was a requested change, so this is **not** being quietly reverted. The question is whether the company page should carry an Email button, which is one line beside Call. As things stand, the "Email" series in members' Clicks overview can only ever read zero. → `src/app/(public)/member/[slug]/page.tsx:146-147`, `src/app/go/[memberId]/route.ts:58`
- [ ] **A9.7 — The stats digest defaults on, but the 18 Sep call says opt-in. This is a spec conflict to confirm, not a build.** REQUIREMENTS §6 asks for an "opt-in periodic performance-summary email". USE-CASES M9 and gap 7 still say default quarterly, and the code does that: `?? "quarterly"` for members with no preference row. Flipping it is one line, but which document wins is Jas's call. → `src/lib/jobs.ts:499`
- [x] **A9.8 — Member advertising "assets" tab (REQUIREMENTS §6, raised as a new idea).** One place listing all of a member's ad assets and their status. Today the tabs are Information / Buy / Manage, and Manage lists bookings, not assets. REQUIREMENTS also names the self-serve advertising buy/manage module as "the next big piece of unbuilt work". → `src/app/dashboard/advertising/AdvertisingTabs.tsx:4-6`
  **Fixed (28 Sep):**
  - A new **Assets** tab, `/dashboard/advertising/assets`. It lists each piece of the member's artwork **once**, with thumbnail, format (the console's own labels, `components/console/advert-formats.ts`) and a "no mobile version" flag, and **every run under it** with its phase, each linking to `/dashboard/advert/[booking]` where the actions already live.
  - Below that are the member's **equipment listings**, with status, reason if sent back, and whether a video is attached (A9.4). There is an Edit link while a listing is still editable.
  - Read-only by design: no forms are duplicated.
  - The phase labels Manage had to itself moved to `src/lib/advert-phase-labels.ts`, so the two tabs can't drift.
  - Registered in `a11y.spec.ts` (axe clean) and in `tests/visual/manifest.ts`. The latter is **a new route with no baseline, so `pnpm visual` fails on it by design** until a person accepts it (HUMAN-TODO 19.3).

  **Not built:** the "self-serve advertising buy/manage module" REQUIREMENTS calls the next big piece of unbuilt work. That is larger than this item and unscoped. *(Working tree, uncommitted.)*
- [ ] **A9.9 — Nav order (REQUIREMENTS §4).** The call asked for the current site's order: a standard navbar (Home / News / Videos / Newsletters / Find a Member) beside the logo, with the Industries bar below it.
  - **Grid:** Industries is correctly below, but there is no Home link and the nav sits in its own bar under the logo row.
  - **Forge:** Industries renders *above* the header, and the nav uses Media/Members dropdowns.

  ⚠ Unverified: I have not confirmed which design the "vertical layout reconfirmed" line refers to. Confirm before changing either. → `src/components/GridSiteHeader.tsx:28-32`, `src/app/(public)/layout.tsx:65-67`
- [x] **A9.10 — Video submissions accept any URL (gap 23: YouTube-only confirmed).** `submitVideo` checks only that `url` is non-empty. A Loom or Vimeo link saves, goes to approval, and never embeds, because embeds are `youtube-nocookie.com` only. The fix is a server-side host check with a readable error. → `src/app/dashboard/actions.ts:195-199`
  **Fixed:**
  - `submitVideo`, `editVideo` and the console's `saveVideo` now refuse any link `youtubeId()` can't read. They redirect with a readable error before any upload or write.
  - The member actions previously returned **silently** on a missing title or url, so the form just re-rendered. They now say what is missing. `/dashboard/video/new` gained the `?error=` banner it lacked.
  - The `YoutubePreview` warning now says the link won't save instead of "it'll save, but won't embed".

  **Found and fixed en route:** `youtubeId()` only understood `watch?v=` links. `youtu.be/…`, `/shorts/`, `/embed/` and `/live/` links never embedded anywhere, including links the console's own tests used. It now parses all of them. It also only accepts YouTube hosts: a `?v=` on another site used to be read as a YouTube id. The member page's company video had its own copy of the old regex, and now uses the helper.

  **Side effect:** a stored video whose link isn't a readable YouTube link can no longer be re-saved until the link is corrected. All 61 local videos parse. I have not checked production; it was imported from the same export.

  ~~**Not done:** the company-page `video_url` field (A8.5's territory) is still unvalidated on save.~~ Done with A8.5: the shared company-page parser now refuses non-YouTube links. *(Working tree, uncommitted.)*

---

## Part B — Blocked on a third-party integration

Several closed B items were written against documented APIs and **have never run against a live account**. Confirm each on its first real use:

- Stripe checkout, subscriptions and cancel (B1.1, B1.5)
- Buffer GraphQL enums (B4.4)
- Resend Broadcasts/Contacts (B5.1) and its webhook fields (A5.4)
- Bigin search and opt-out (B6.1, B6.3)

### B1 · Stripe (payments)

- [ ] **B1.7 — Checkout is a redirect, not an embedded modal (V13).** `StripePayments.createCheckout` creates a redirect-mode Checkout Session (`mode: "subscription"`, `success_url`/`cancel_url`, no `ui_mode`). `pay/actions.ts` does a full-page `redirect(payment.url)`. This needs Embedded Checkout or the Payment Element. → `src/lib/adapters/payments.ts:94-105`, `src/app/dashboard/pay/actions.ts`

**Closed:** B1.1 `StripePayments` · B1.2 `getPayments()` branches on the key · B1.3 webhook + mock simulator · B1.4 failed payment → grace · B1.5 member-side cancellation · B1.6 moved to "What is solid" (standing constraint).

### B2 · GeoIP — MaxMind / GeoLite2

**Closed:** B2.1 fabricated region removed (GeoLite2 still unwired, see D2) · B2.2 stats say company resolution is parked.

### B3 · Email — Resend

- [ ] **B3.3 — No key exists yet.** All email is inert until an SMI-owned Resend account is created, the domain is verified (SPF/DKIM/DMARC) and `RESEND_API_KEY` is set. Creating accounts and sending real mail are approval-gated (`BUILD-PLAN.md`). See `.env.example`.
- [ ] **B3.4 — Supabase auth mail stays outside the template system (fix-list 63).** The admin-reply half closed in fix-list 71b. Password-recovery mail leaves via Supabase's own mailer, so customising it is a hosted-dashboard job (HUMAN-TODO §2.1). `README.md` forbids doing it from `config.toml`.
  **Found and not fixed:** the shared `_shell` footer says "You're receiving this because you have a Sheet Metal Industries member account." That is untrue for a reply to a contact-form enquiry from a non-member. The fix needs a conditional footer or a second shell. → `src/lib/email/defaults.ts:583`, `src/app/reset/page.tsx:35`
- [ ] **B3.5 — Contrast and client-safety can't be machine-checked for edited email copy (fix-list 63).** The rule keeping brand orange off email body text is tested over the *shipped defaults* only. Console-edited HTML is not validated beyond "it renders and its placeholders exist". This is the accepted cost of full-HTML editing. The mitigations are the per-template preview and one-click reset. → `src/lib/email/defaults.ts`, `tests/unit/email-templates.test.ts`

**Closed:** B3.1 sender surfaces failures, dev mail goes to Mailpit · B3.2 reset live once keyed.

### B4 · Social publishing — Buffer

- [ ] **B4.3 — Real LinkedIn @-tagging (S3).** Buffer's GraphQL API supports it (`metadata.linkedin.annotations[]`), but four things are missing:
  1. A nullable `members.linkedin_org_urn` column. `members.social` holds a vanity slug, not the numeric org id.
  2. A backfill of those ids. It needs an approved LinkedIn app with `r_organization_admin`, or Jas pasting ids, and is approval-gated (HUMAN-TODO).
  3. `start`/`length` offsets computed after `formatTags()` assembles the text. ⚠ It is unverified whether LinkedIn counts these offsets in UTF-16 units or code points.
  4. `SocialChannels.channelIds` becoming `{ id, service }[]`, so the metadata goes only on the LinkedIn mutation.

  LinkedIn only lets a Page tag companies that follow it, so a tag can legitimately fail to render. → `src/lib/adapters/social.ts` (`formatTags()`)

**Closed:** B4.1 image + channel targeting (transport since replaced by B4.4) · B4.2 handles come from `members.social`; there is no separate CRM handle field · B4.4 ported from the dead v1 REST API to GraphQL.

### B5 · Newsletter delivery

**Closed:** B5.1 Resend sender, the candidate under test (Jas's MailChimp deliverability gate still open) · B5.2 unsubscribe + webhook sync-back · B5.3 issue preview, edit and video pick.

### B6 · CRM — Bigin / Zoho

**Closed:** B6.1 `BiginCrmSync` · B6.2 public signup pushes to Bigin · B6.3 dedupe write-through + unsubscribe sync-back.

---

## Part C — Honesty fixes owed because Part B is unfinished

**Closed:** C1 stub refuses to "pay" in production · C2 invented region data removed · C3 failed newsletter sends surface as `send_failed` · C4 not a gap (copy is accurate) · C5 pay-page copy follows `paymentsAreLive()` · C6 consent undercount measured and disclosed (the underlying choice is D1).

---

## Not gaps — deferred by design

Per [`PHASE-1-TECHNICAL.md §04`](../../proposal/PHASE-1-TECHNICAL.md), these are deferred by design:

- Content OS and the kanban "suggested" column (module 6)
- Named-company click identification (F·43, parked)
- The marketplace
- Tiered membership
- Trade contact-list building
- Survey capture and reporting
- From the 18 Sep call: multi-user/sub-account logins (REQUIREMENTS §19) and non-YouTube video hosts (gap 23)

These are not engineering gaps either, so they are tracked elsewhere:

- **The WordPress agency's liquidation and hosting takeover** (USE-CASES gap 26) is external and time-sensitive. It belongs in HUMAN-TODO.
- **Industries** became their own table, directly linked from stories, videos and events, on 10 Sep (migration `20260909000002`). Existing content was backfilled from its member only. A story's industry is now a snapshot, not a join.

## What is solid — do not re-litigate

- Advert neutrality: `uniformShuffle` / `dealSlots`, no weight column, duplicate-booking dedupe, unit-tested
- Impression honesty: viewability gating, load verification, server-side booking revalidation in `/api/seen`
- The approval gate: no path publishes unapproved content, and `activationBlocked` makes activation payment-gated and audit-logged
- The adapter-based fail-safe structure, which makes S8 true by construction
- Unsubscribe permanence
- The advert lifecycle state machine and its `btree_gist` exclusion constraint
- Legacy-URL 308 handling
- `ilikeTerm` / tsquery injection sanitising
- RLS coverage
- **B1.6: existing Stripe subscriptions are never touched.** A cancel acts only on a subscription id this app itself wrote.

## Open decisions

**Decided and built 28 Sep:**
- **D1 — Consent vs. advertiser reporting (C6).** **Decided (Luiza, 28 Sep): impressions are counted whether or not the reader accepted cookies, and never used to change what anyone sees.**
  - `/api/seen` now records the `ad_impression` of a reader who declined, with every identifying field explicitly null: no session hash, referrer, region or company. The row is just advert, page and time.
  - Rotation reads no impression data (uniform, no weight column), so the second half of the decision holds by construction.
  - Clicks, page views and every other event stay consent-gated in `record()`.
  - `/dashboard/stats`'s disclosure now says impressions are complete from 28 Sep (anonymous when declined) and the rest is still a consented-only floor.
  - Tests are in `api-seen-route.test.ts`.
  - Still worth a line in the site's Policies page: `ask-jas.md` §19. *(Working tree, uncommitted.)*
- **D2 — Region (C2 / B2).** Wire GeoLite2 now, or ship without region until the MaxMind key is approved?
- **D4 — Unconfirmed spec gaps.** These items are built to the working assumptions in `USE-CASES.md` and are still unconfirmed:
  - **5, grace days before a lapsed page is hidden.** The code hardcodes **30** in two places, `src/lib/membership.ts:168` and `src/lib/jobs.ts:440`, with no shared constant.
  - **11, 13, 15** (skyscraper specs, the bundle label, featured-member rotation).
  - **24, the lead-gen disclaimer wording**, which blocks A8.3/A8.4.
- **D5 — How is "social media reach" calculated?** (REQUIREMENTS §26.) The grid homepage's membership-value band shows a hardcoded `SOCIAL_REACH = 347_000`, whose own comment says it has no source in the database. The same number blocks the social half of A9.2. → `src/components/grid-home/cards.tsx:513`

**Closed:** D3 advert click target (`link_url` legitimately overrides the member page, see A6.12).
