# Implementation gaps — Phase 1

Audited 31 Aug 2026 against [`USE-CASES.md`](../../requirements/USE-CASES.md) (60 use cases: V1–V18, M1–M13, A1–A27, S1–S8).

**Part A** is buildable today with no external account or key. **Part B** needs a third-party service wired.
**Part C** are honesty fixes we owe *because* Part B is unfinished — all buildable now, all high priority.

Every item is numbered so it can be referenced directly (e.g. "do A2.1 and A2.2"). Tick items as they land; add the commit SHA next to a ticked item.

---

## Part A — Buildable now, no third-party dependency

### A1 · Content & CMS CRUD — *first priority*

- [x] **A1.1 — Console story form has no cover image upload.** `saveStory` never touches `cover_path`, and the crop picker only renders `{cover && …}`. An admin-authored story can only get a cover if a member uploaded one. → `src/app/console/actions.ts:29`
  **Fixed:** new `CoverField` client component (file input + live `URL.createObjectURL` preview + the crop picker, so the crop works on the first upload, before any save) used by both the console editor and the member form; `saveStory` uploads to the `stories` prefix with the `saveEvent` try/catch + conditional-spread shape, so an empty input keeps the existing image. `canWrite` moved above the upload (it was checked after `values` was built, so a non-writing account could put bytes in the public bucket and get nothing written), and `updated_at` added — `saveStory` was the only save action omitting it, and there are no DB triggers. Error banner added to the editor, which previously redirected to a `?error=` it never rendered. *(Working tree, uncommitted.)*
  **Storage:** covers are downscaled to 2000px and re-encoded to WebP in the browser before upload (a 3.4MB PNG landed as 19KB), keeping the original when the re-encode is bigger or the source is an animated GIF; `uploadImage` now sets `cacheControl: 31536000` (paths are timestamped and never overwritten, so stored objects are immutable); a replaced cover's old object is swept via the new best-effort `removeMedia`, since there is no media library to collect orphans (A1.4).
  **Found and fixed en route:** every upload in the app goes through a server action, and Next caps action bodies at 1MB by default — so `uploadImage`'s 8MB cap and `uploadDocument`'s 20MB cap were unreachable: anything larger 500'd with "Body exceeded 1 MB limit" into the error boundary instead of the readable message the forms are written to show. `next.config.ts` now sets `experimental.serverActions.bodySizeLimit: "22mb"`.
- [x] **A1.2 — Cover crop is a no-op.** `cover_focus` is written by `FocusPicker` and read nowhere else — the public story hero ignores `objectPosition`/`scale`. Apply it in the hero and in cards. → `src/app/console/actions.ts:42`, `src/app/(public)/news/[slug]/page.tsx:68`
  **Fixed:** new `src/lib/focus.ts` (`parseFocus` / `focusStyle` / `focusVars`, unit-tested) is the single reader of the jsonb, and `cover_focus` now travels on the shared `STORY_CARD` projection, the newsletter-items select and `HeroItem`. Applied at all six render sites: story hero, `StoryCard` (news grid, search, related, member list, home carousels), `home.grid`'s `StoryRow`, the home hero stage and rail thumb, and the newsletter issue row. Pan is `object-position`; zoom is anchored with `transform-origin` on the same point, so the subject stays put — `FocusPicker` uses the same helper, so the preview is what the site renders. **At scale 1 no transform is emitted at all**, so every story that predates the crop renders exactly as before. The two hero images take the zoom as `--focus-scale` instead, because ken-burns owns their `transform` and an animation outranks an inline style. Also added `overflow-hidden` to `StoryCard`'s media box — a zoomed cover spilled over the headline. *(Working tree, uncommitted.)*
- [ ] **A1.3 — No category CRUD (A22).** `categories` is read in three console pages and written nowhere; adding one of the ~30 categories still needs a developer or a seed run.
- [ ] **A1.4 — No media library (A24).** Uploads are per-form and write-only. Nothing lists, browses, re-uses, renames or deletes stored media. No `/console/media` route. → `src/lib/media.ts`
- [ ] **A1.5 — Advertising page copy and specs are hardcoded (A22).** The six format cards live in the page source; only the media-pack PDF is editable. Specs are given for two formats and omitted for four. → `src/app/(public)/advertising/page.tsx:7`
- [ ] **A1.6 — `saveLayout` silently no-ops for static pages.** The console offers a "Content pages" tab; `PAGE_TYPES` excludes `static_page`, so saving returns with no effect and no error. → `src/app/console/actions.ts:338`
- [ ] **A1.7 — Homepage grid mix is not configurable (A13).** The block editor has no `home` page type; the ~12-block mix is hardcoded in the two home view modules. (Slot caps, the other half of A13, do work.) → `src/lib/blocks/schema.ts`
- [ ] **A1.8 — Event types do not exist (V11 / M4).** No `type` column on `events` in any migration, no selector on the member or console form, no label on the listing. Spec requires webinar / live event / open house / exhibition / golf challenge. → `supabase/migrations/20260808000001_core.sql:80`
- [ ] **A1.9 — No console inbox page (V18).** The overview shows only the 5 most recent *unread* contact messages; a 6th enquiry, or anything marked read, is unreachable in the UI. → `src/app/console/page.tsx:65`
- [ ] **A1.10 — Kanban has no drag (A8).** Four read-only columns. dnd-kit is already installed and used in `DevBoard.tsx` and `LayoutEditor.tsx`. → `src/app/console/stories/page.tsx:74`
- [ ] **A1.11 — Member story library capped on the member page (V9).** The `member_news` block slices to `props.limit` (default 4, hard max 8), so a member with 30 stories shows 4. Spec says "every SMI story about that company". → `src/lib/blocks/schema.ts:130`

### A2 · Advert & inventory management — *first priority*

- [ ] **A2.1 — Homepage takeover does not exist (V17 / A12).** `placement_kind='takeover'` and `placements.config {hex, banner_path}` are in the schema; nothing in `src/` reads them. No console form, no theme application, no contrast check. It is on the rate card as Format C and `/advertising` sells it. → `supabase/migrations/20260808000002_commerce.sql:43`
- [ ] **A2.2 — Featured Member cannot be booked (A11).** `placements.insert` appears exactly once and hardcodes `kind:"featured_machine"`. The homepage renders `featured_member` placements and the Command Centre bills for them, but only the seed script creates them. Mirror `saveMachinePlacement`. → `src/app/console/actions.ts:433`, `src/app/(public)/home.data.ts:63`
- [ ] **A2.3 — Bundles have no UI (A14).** `saveBooking` reads a `bundle_id` form field that no form renders, so it is always null. No multi-format artwork collection, no schedule-all-parts, no bundle-account label. The label must provably not touch `dealSlots` (neutrality rule). → `src/app/console/actions.ts:469`
- [ ] **A2.4 — Newsletter advert slots are unwritable and unrendered (A15 / M8).** ~~no reader~~ Reader done 31 Aug: `renderIssueHtml` renders booked slots into the issue (mobile creative — the email column is ≤600px; worth confirming with Jas). **Still open: there is no writer** — nothing can book a newsletter slot, so the renderer has nothing to draw. → `src/lib/adapters/newsletter.ts`
- [ ] **A2.5 — Members cannot reach their own live adverts (M11).** The dashboard lists only draft / awaiting_approval / review_required bookings, so scheduled, live and ended runs appear nowhere — the "Run it again" renewal form is reachable only by bookmark. Partly mitigated 31 Aug: the advert emails now deep-link straight to `/dashboard/advert/{booking_id}` instead of saying "log in and renew", so the form is at least reachable from the email. **The dashboard listing itself is still wrong.** → `src/app/dashboard/page.tsx:32`
- [ ] **A2.6 — Buy-visibility requests never notify the member (M11).** ~~The member is never told either way.~~ Notification done 31 Aug: confirm and decline both enqueue `visibility_confirmed` / `visibility_declined`. **Still open:** confirming creates no `invoices` row. → `src/app/console/actions.ts`
- [ ] **A2.7 — No billing on advert approval.** `advert_products.rate` exists and bookings carry `product_id`, but no invoice row is created when a run is approved. The money side of the advert lifecycle is entirely offline.
- [ ] **A2.8 — `news_mid` slot is gated on result count.** `/news` renders it only when `stories.length > 6`, so booked inventory silently disappears on the last page or a narrow category. `/event`, `/video` and `/member` render theirs unconditionally. → `src/app/(public)/news/page.tsx`
- [ ] **A2.9 — `mpu` has no mobile artwork variant.** It renders `desktopPath` at every breakpoint, unlike banner / rail / in-feed. → `src/components/AdCreative.tsx:106`
- [ ] **A2.10 — Only one advert renders per slot (S1).** `dealSlots` hands each slot 3 adverts; `AdSlot` renders `adverts[0]`. Spec says each slot cycles its ~3 adverts. Decide: in-page carousel, or accept one-of-three-per-load and update the spec. → `src/components/AdSlot.tsx:19`
- [x] **A2.11 — Migration `set not null` had no guard.** `20260829000001_adverts_belong_to_members.sql` backfills `adverts.member_id` from `advertisers.member_id` — a column declared nullable with `on delete set null` — then sets it `not null`, relying on an assumption the file stated in prose but never checked. **Fixed:** added a `do $$ … raise exception $$` pre-check that fails with a readable message and no DDL applied. Checked the remote before pushing: 13 advertisers, 0 with a null `member_id`, so the push is clean. *(Working tree, uncommitted.)*

### A3 · Publishing pipeline & scheduling

- [ ] **A3.1 — Production cron runs once a day at 03:00** while `src/lib/jobs.ts` assumes minute-level ticks (`publish_scheduled` every 60s). Scheduled stories publish up to 24h late, the "~30 min later" social push lands at the next 03:00, and a newsletter scheduled for 10:00 sends the following morning. Degrades A6, S3 and every scheduled send. → `vercel.json`
  **Deferred (31 Aug 2026)** — not live yet, and a tighter cron means more invocations. Revisit before launch; nothing is scheduled for real audiences until then. The fix is one line, so this costs nothing to hold.
- [ ] **A3.2 — Video pinning is dead state (A26 / V6).** `pinVideo` writes `videos.pinned_until`; `publishedVideos()` orders by `published_at` only and never reads it. `/video` also has no hero player at all. (Contrast `headlineStory()`, which honours the story pin correctly.) → `src/lib/queries.ts:93`
- [ ] **A3.3 — Pin duration is hardcoded to 2 days** for both stories and videos; the spec says the admin sets it. No pin control on the story detail page. → `src/app/console/stories/page.tsx:104`
- [ ] **A3.4 — Approve-then-schedule is impossible (A2).** Approve always publishes immediately; the Schedule card renders only for draft/rejected/scheduled.
- [ ] **A3.5 — No press-release diary reshuffle (A5).** "Publish now" works, but nothing re-spaces the other scheduled stories; the social cap just bumps overflow to 09:00 tomorrow. → `src/lib/jobs.ts:156`
- [ ] **A3.6 — Story approval has no real preview (A2).** The "Member preview" card is a mock badge reading "Backlink + footer branding", not the published page, and there is no view-as-published link.
- [ ] **A3.7 — `social_caps` has no console editor** despite being read from settings by the job.

### A4 · Member area

- [x] **A4.1 — Password reset is missing (M2).** Done 31 Aug: `/reset` → emailed link → `/reset/confirm` (route handler, since exchanging the token has to set cookies) → `/reset/new`. Supabase mints and validates the token; mail leaves via Resend SMTP configured **in the hosted dashboard**, never `config.toml` (README: never `supabase config push`). Both `token_hash` and PKCE `code` links are accepted, so opening the email on a different device from the request still works — the common case for someone locked out. Local `site_url` also corrected from port 3000 to 3100, which had made every local recovery link point at nothing. → `src/app/reset/`
- [ ] **A4.2 — Notification prefs are dead state (M9 / S5).** The settings UI persists quarterly/weekly defaults; no job reads them. `JobKind` has no `featured_day`, `stats_summary` or `lead_alert` — none of the three automatic emails exists as a job. (Delivery itself is B3.) → `src/lib/jobs.ts:11`
- [ ] **A4.3 — Grace → lapsed never transitions (M13 / S7).** `comp_expiry` handles expiring promo comps only; nothing acts on `grace_until` passing. (Failed-card detection is B1.) → `src/lib/jobs.ts:219`
- [ ] **A4.4 — Lapsed members leave orphaned backlinks.** Their published stories stay publicly readable while their member page 404s.
- [ ] **A4.5 — Profile edits omit map, testimonials and extra media (M5).** lat/lng and testimonials are console-only and the address is never geocoded, so the member-page OSM map renders nothing for any self-served member. → `src/lib/member-form.ts:77`
- [x] **A4.6 — Page-edit approvals are silent (M5).** Done 31 Aug: `decideRevision` now enqueues `page_changes_live` / `page_changes_rejected`, matching the other five approval flows. *(The reject form still submits no reason — that half remains open.)* → `src/app/console/actions.ts`
- [ ] **A4.7 — Invoices are rows, not documents (M12).** `invoices.pdf_path` is written by nothing; every row renders the dead label "PDF soon". Needs a PDF generation step. → `src/lib/membership.ts:82`
- [ ] **A4.8 — The stale-story nudge never fires for members who have never posted (M10).** `monthsSince` is null with no published story and the render guards on `!== null` — the people most needing the prompt see nothing. → `src/app/dashboard/page.tsx:40`
- [ ] **A4.9 — Signup collects almost nothing to auto-populate (M1).** `provisionMember` writes only `name` + `contact_email`; the profile form has no company-name field. `/join` step 3 promises "we auto-fill what we know". → `src/lib/membership.ts:55`
- [x] **A4.10 — Notification feed renders raw enum strings.** Done 31 Aug: both the feed and the emails read from one `notificationLabel()` table, so they cannot drift apart. → `src/lib/email/templates.ts`
- [ ] **A4.11 — No comp-via-promo-code in admin (A17).** The console comps by entering a number of months; promo codes are hardcoded in the payments stub for the public join flow and are not manageable anywhere.

### A5 · Reporting & analytics surfaces

- [ ] **A5.1 — Search queries are never logged (V4).** `/search` records `{kind:"page_view", path:"/search"}` and drops `q`. No `search_queries` table exists. → `src/app/(public)/search/page.tsx:18`
- [ ] **A5.2 — No search report (A27).** Blocked on A5.1.
- [ ] **A5.3 — No admin analytics surface at all (A21).** No `/console/analytics` route. Events, referrers and daily rollups are all captured and nothing in `/console` reads them — no traffic view, no most-read stories, no referrer mix, no AI-referrer classification. → `supabase/migrations/20260809000001_rollup_fn.sql`
- [ ] **A5.4 — No newsletter performance metrics (A16).** `newsletter_issues` has no sends/opens/clicks columns.
- [ ] **A5.5 — Member stats have no month-on-month comparison (M7).** Two scalars — a 30-day count and a 12-month count — never a delta or a trend series. Gap 6 item 1 asks for a 12-month trend. → `src/app/dashboard/stats/page.tsx:56`
- [ ] **A5.6 — No outbound-website click tracking (M7, Gap 6 item 3).** `EventKind` has no such kind and `/visit/[id]` is advert-only, so "clicks to their website" cannot be reported. → `src/lib/analytics.ts:10`
- [ ] **A5.7 — Newsletter stats are wrong (M8, Gap 6 item 5).** "Featured in N issues" counts `newsletter_items` unfiltered by sent status *and* unfiltered by year; "~2,500 trade readers" is a hardcoded literal; newsletter advert clicks are absent entirely. → `src/app/dashboard/stats/page.tsx:41`
- [ ] **A5.8 — Member activity timeline is incomplete (A18).** Merges stories, placements, invoices and notifications but omits advert clicks and newsletter appearances, both of which are queryable. → `src/app/console/members/[id]/page.tsx:76`
- [ ] **A5.9 — CRM view has no site activity and no search (A19).** A hardcoded `limit(200)` most-recent slice. → `src/app/console/crm/page.tsx`

### A6 · Public site compliance & polish

- [ ] **A6.1 — "Oldest" sort is still on /news.** Jas removed it on 19 Aug (V3, spec Gap 10). → `src/app/(public)/news/page.tsx:18,48`
- [ ] **A6.2 — No mobile navigation (V16).** `Members`, `Featured Machine`, `Events` and `Advertising` are each `hidden` below their breakpoint and there is no hamburger menu anywhere. On a phone, `/event` and `/featured-machine` are unreachable from header and footer. → `src/components/SiteHeader.tsx:37`
- [ ] **A6.3 — Media dropdown contents don't match the spec.** It carries News / Videos / Newsletters / Magazine; the spec puts Advertising inside it. Advertising is a top-level link that is `hidden lg:block`, so it vanishes below 1024px.
- [ ] **A6.4 — Directory map view does not exist (V8).** No map library, no toggle — the directory is list-only. Depends on members having lat/lng (see A4.5). The member *page* map is real.
- [ ] **A6.5 — Directory is logo-led in name only (V8).** A text card with a 44px logo; `contact_email` is never selected or shown, so "contact via email" is missing.
- [ ] **A6.6 — Member directory is unpaginated** — every active member in one response. `/video`, `/event` and `/search` are fixed caps with no next page and no indication results were truncated. Only `/news` paginates properly.
- [ ] **A6.7 — Search bar is missing from /news and /video (V4)**, and from the default homepage — `siteVariant` defaults to `forge`, which has no search form. Spec requires it on home, news, videos and members.
- [ ] **A6.8 — No "member stories only" filter on search results (V4).** Members-rank-first is correctly implemented.
- [ ] **A6.9 — Member videos are not highlighted (V6).** `VideoCard` prints the member name in grey `text-xs`; there is no badge equivalent to the story `MemberBadge`.
- [ ] **A6.10 — Videos are not woven into the /news grid (V6)** — only into the homepage grid. `/news` renders stories only.
- [ ] **A6.11 — No cookie-settings link in the footer (V15)** — the choice cannot be changed after the first visit.
- [ ] **A6.12 — Advert `link_url` overrides the member page.** `resolveAdvertTarget` prefers `link_url`, so a banner with a link never reaches the advertiser's member page. Spec V2 says the click lands on the member page; A9 says member page is the *default* target. Confirm which. → `src/lib/adverts.ts:192`
- [ ] **A6.13 — No join-as-member route on the advertising page (V14).** No link to `/join` anywhere in the file.

### A7 · Platform & admin

- [x] **A7.1 — Two roles (`admin`, `member`) is the intended model, not a gap.** Admins are provisioned directly in the database; members are created by the join funnel (`src/lib/membership.ts:67`) and the console's `createMember` + `sendAccountInvite`. There is no third role and no plan for one, so no `/console/users` is needed. Role enforcement is app-code only (`requireConsole`/`requireMember` in `src/lib/auth.ts`) because RLS cannot see `profiles.role` — see A7.3. The now-decorative `canWrite`/`canApprove` scaffolding (both reduced to `role === "admin"`, already implied by `requireConsole`) has been removed, along with the dead UI branches it gated.
- [ ] **A7.2 — Revenue is estimated from a hardcoded rate card (A1).** Only `banner` and `supplier_logo` carry prices; skyscraper / mpu / in_feed / newsletter_banner / association_logo bookings all score £0. → `src/lib/pricing.ts`
- [ ] **A7.3 — Member-area DB access is all service-role**, bypassing RLS, with ownership enforced by hand. Correct today, but one forgotten check is an IDOR. Consider a shared `assertOwnsMember()` helper.
- [ ] **A7.4 — Silent no-op failure modes.** `saveLayout` returns silently for static pages. Does not surface to the operator. (The `canWrite`-gated `saveStory`/`saveVideo` silent returns were removed along with A7.1's dead guards.)
- [ ] **A7.5 — Cron fails closed when `CRON_SECRET` is unset**, and the "dead job" warning that would reveal it only appears once jobs go dead — which never happens if nothing runs. → `src/app/api/cron/route.ts:17`

---

## Part B — Blocked on a third-party integration

### B1 · Stripe (payments)

- [ ] **B1.1 — Stripe is not integrated at all.** `getPayments()` unconditionally returns `LocalStubPayments`, whose card path returns `{kind:"paid"}`. `stripe` is not a dependency; there is no webhook route. `STRIPE_SECRET_KEY` is read only to change copy. → `src/lib/adapters/payments.ts:34`
- [ ] **B1.2 — Implement `StripePayments`** behind `STRIPE_SECRET_KEY`; make `getPayments()` actually branch on it.
- [ ] **B1.3 — Add `/api/stripe/webhook`** handling `checkout.session.completed` and `invoice.payment_failed`.
- [ ] **B1.4 — Wire `invoice.payment_failed` → grace period start** (pairs with A4.3).
- [ ] **B1.5 — Member-side cancellation (M13)** — no path exists.
- [ ] **B1.6 — Existing Stripe subscriptions must never be touched** (TECH-DECISIONS #16). Constraint to hold, not work to do.

### B2 · GeoIP — MaxMind / GeoLite2

- [ ] **B2.1 — Region is currently fabricated** — see C2. Wire GeoLite2 (£0 in the proposal budget, key pending approval) or return null. → `src/lib/adapters/company-resolver.ts`
- [ ] **B2.2 — Company resolution is parked for Phase 1** (M7 "someone at British Aerospace" — F·43, "NOT NOW"). `/dashboard/stats` should say so rather than always rendering "Company unknown".

### B3 · Email — Resend

- [x] **B3.1 — Needs the key, not code.** ~~`ResendSender` is real behind `RESEND_API_KEY` and falls back to console logging.~~ Done 31 Aug: the claim was true but incomplete — the sender never read the Resend response, so a bad key or unverified domain would have failed **invisibly**. It now throws on non-2xx (job retries, then dead-letters into "Needs You Today"), honours `Retry-After` on 429, and the dev fallback finally sends to Mailpit instead of only logging. `notifications.emailed_at` is written. → `src/lib/adapters/email.ts`, `tests/unit/email.test.ts`
- [x] **B3.2 — Once keyed.** A4.1 password reset is live. The A4.2 digest jobs remain open — they are a missing feature, not a delivery problem.
- [ ] **B3.3 — No key exists yet.** Everything above is inert until an SMI-owned Resend account is created, the domain verified (SPF/DKIM/DMARC) and `RESEND_API_KEY` set. Creating accounts and sending real mail are approval-gated (`BUILD-PLAN.md`). See `.env.example`.

### B4 · Social publishing — Buffer

- [ ] **B4.1 — `BufferPublisher` POSTs `text` only** — no image, no `tagHandles`, no channel targeting, with an unresolved in-file note asking whether Buffer supports company @-tagging at all. Spec S3 requires exact-handle @-tags. → `src/lib/adapters/social.ts:47`
- [ ] **B4.2 — Handles come from `members.social`**, not the CRM-stored handle A4 specifies.
- [ ] **B4.3 — Resolve the @-tagging question** before committing to Buffer.

### B5 · Newsletter delivery

- [x] **B5.1 — No sender exists.** ~~Choose an ESP.~~ Done 31 Aug: **the ESP is Resend** — the MailChimp deliverability gate is closed (TECH-DECISIONS #7, superseded). `ResendNewsletterSender` builds the issue HTML from `newsletter_items` *and* `newsletter_ads` and sends it as a Broadcast; a daily `newsletter_sync` job mirrors `contacts` to the provider, without which a broadcast would have no recipients. ⚠ Written against Resend's documented API but never run live — confirm the Broadcasts/Contacts shapes on the first real send. → `src/lib/adapters/newsletter.ts`
- [x] **B5.2 — No reader-facing unsubscribe route anywhere.** Done 31 Aug: broadcasts carry Resend's hosted one-click unsubscribe (RFC 8058, `List-Unsubscribe` set for us — not worth hand-rolling), and `/api/webhooks/resend` mirrors unsubscribes, hard bounces and spam complaints back into `contacts` through the tested `applyOptIn`, so our table stays authoritative. A plain `/unsubscribe` page covers the web archive. → `src/app/unsubscribe/page.tsx`, `src/app/api/webhooks/resend/route.ts`
- [ ] **B5.3 — No preview/proof step and no way to edit an issue after creation** (no `updateIssue` action). No video pick in the composer.

### B6 · CRM — Bigin / Zoho

- [ ] **B6.1 — No client exists.** `sync()` only stamps `last_synced_at`; `pushContact()` is a `console.log`. `bigin_id` is never written. No OAuth, no `BIGIN_*` env usage. → `src/lib/adapters/crm.ts`
- [ ] **B6.2 — Public newsletter signup never calls `pushContact`** — only the console CRM page does, so a public signup never reaches Bigin even once a client exists. → `src/app/(public)/actions.ts:8`
- [ ] **B6.3 — Unsubscribe sync-back (S6) and no-duplicate write-through (A20)** both depend on B6.1.

---

## Part C — Honesty fixes owed because Part B is unfinished

All buildable now. These are the items where the running site currently tells a paying customer something untrue.

- [ ] **C1 — Anyone can "pay" for free.** With the stub, completing `/join` step 2 stamps `paid_at`, writes a £40 invoice row and makes the member eligible for activation with no money moving. Until B1 lands, gate the card path off in production or make the simulation unmistakable. → `src/lib/adapters/payments.ts:21`
- [ ] **C2 — Member region data is invented.** `stableRegion()` hashes the IP string modulo ten hardcoded UK regions, persists it to `analytics_events.region`, rolls it into `engagement_audit` and shows it to paying members on `/dashboard/stats` under the heading "Real, unpadded numbers". Return null until B2 lands. → `src/lib/adapters/company-resolver.ts`
- [x] **C3 — Newsletter issues are marked `sent` without being sent.** Done 31 Aug: `sendIssue` returns a result, the status follows it, and a failure lands in a new `send_failed` state with the error stored — surfaced at the top of "Needs You Today" and as a Failed column on the newsletter board with a "Try again". The stub still reports success so local dev walks the flow, but logs plainly that no mail left the building. → `supabase/migrations/20260831000001_newsletter_send_failed.sql`, `src/lib/jobs.ts`
- [ ] **C4 — Public copy promises unbuilt features.** `/join` says "Payments handled securely by Stripe"; `/advertising` sells Format C "Homepage Takeover" with "WCAG 2.1 A compliance applies" against a feature with no implementation.
- [ ] **C5 — `/dashboard/pay` says "not simulated" while payment is simulated.** The page and action branch on `STRIPE_SECRET_KEY` to change the copy, but `getPayments()` ignores the key entirely. Setting it produces reassuring text over a stub. → `src/app/dashboard/pay/page.tsx:15`
- [ ] **C6 — Advertiser and member metrics are an undisclosed undercount.** `record()` drops every event without `smi-consent=all`, so impressions and clicks — the numbers invoiced against advertisers — are sampled at the accept rate. The module is meticulous about *over*counting and silent about this much larger *under*count. Needs decision D1 below, then disclosure on `/dashboard/stats` and in advertiser reporting. → `src/lib/analytics.ts:31`

---

## Not gaps — deferred by design

Per [`PHASE-1-TECHNICAL.md §04`](../../proposal/PHASE-1-TECHNICAL.md): Content OS and the kanban "suggested" column (module 6) · named-company click identification (F·43, parked) · marketplace · tiered membership · trade contact-list building · survey capture and reporting.

## What is solid — do not re-litigate

Advert neutrality (`uniformShuffle` / `dealSlots`, no weight column exists, duplicate-booking dedupe, unit-tested) · impression honesty (viewability gating, load verification, server-side booking revalidation in `/api/seen`) · the approval gate (no path publishes unapproved content; `activationBlocked` makes activation payment-gated and audit-logged) · adapter-based fail-safe structure (S8 true by construction) · unsubscribe permanence · the advert lifecycle state machine and its `btree_gist` exclusion constraint · legacy-URL 308 handling · `ilikeTerm` / tsquery injection sanitising · RLS coverage.

## Open decisions

- **D1 — Consent vs. advertiser reporting (C6).** Accept and disclose the undercount, or count impressions under legitimate interest with only identifiable data gated on consent? Legal as much as product.
- **D2 — Region (C2 / B2).** Wire GeoLite2 now, or ship region-less until the MaxMind key is approved?
- **D3 — Advert click target (A6.12).** Does `link_url` legitimately override the member page, or is the member page always the destination?
- **D4 — Unconfirmed spec gaps.** Several items sit against gaps still marked ⚠ / 🔴 in `USE-CASES.md` (5, 11, 13, 15). Build to the working assumptions, or hold for Jas?
