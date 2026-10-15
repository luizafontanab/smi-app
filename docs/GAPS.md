# Implementation gaps — Phase 1

Audited 31 Aug 2026 and reconciled 1 Sep. **Re-reconciled 27 Sep 2026** against the 18 Sep call, as written into [`USE-CASES.md`](../../requirements/USE-CASES.md) open-gaps rows 19–26 and the `[18 Sep]` lines of [`REQUIREMENTS.md`](../../REQUIREMENTS.md). The audit covers 70 use cases: V1–V18 + V11b, M1–M14, A1–A29, S1–S8.

**Part A** can be built today with no external account or key. **Part B** needs a third-party service wired. **Part C** covers honesty fixes owed because Part B is unfinished.

Every item is numbered so it can be referenced directly, for example "do A2.1 and A2.2". Tick items as they land and add the commit SHA next to each ticked item.

**Closed items are tombstoned.** Each section ends with a one-line index of its closed IDs. The full write-ups (what was built, trade-offs, what was found en route) are in git: `git show 320e28e:docs/GAPS.md` for items closed up to 27 Sep, `git show 5b2a9ad:docs/GAPS.md` for the A8/A9 pass closed 28 Sep. The 4–5 Oct notes on A1.7, A2.10 and A8.2 were collapsed before they were committed, so their one-line entries carry the essentials. Only `fix-list.md` keeps ticked `[x]` items; every other list collapses them. Numbers are permanent and never reused, because code comments, tests and migrations cite them. When an item closes, move it into its section's **Closed** line.

When an item is *coded but inert* pending an account, key or approval, the human step is in **[`HUMAN-TODO.md`](HUMAN-TODO.md)**. Open client questions are in **[`ask-jas.md`](ask-jas.md)**. Feature-parity scoping for the member area is in **[`legacy-members-admin-inventory.md`](legacy-members-admin-inventory.md)**.

---

## Part A — Buildable now, no third-party dependency

### A1 · Content & CMS CRUD

- [ ] **A1.5 (residual) — Specs for advertising formats B/C/D/F are still blank.** The copy is editable at `/console/advertising`, but no real dimensions were available to enter, and nobody should invent them. Someone who owns the rate card has to fill them in. → `src/app/(public)/advertising/page.tsx`

**Closed:** A1.1 console cover upload · A1.2 cover crop applied at every render site · A1.3 category CRUD · A1.4 media library · A1.5 advertising format copy editable (residual above) · A1.6 static-page layouts save · A1.8 event types · A1.9 console inbox · A1.10 kanban drag, stories and events · A1.11 member story library uncapped · A1.7 homepage section mix: a "Homepage sections" card on `/console/pages` sets the order and visibility of the five below-the-fold sections on grid (28 Sep; paid sections can move but never hide, banners always sit between content; per-section item counts deliberately not done). Since 4 Oct the slot caps are one sitewide banner-spot count on Inventory (`20261004000002_banner_spots.sql`) · A1.12 member page edits notify the console as `page_edit_submitted` (28 Sep).

### A2 · Advert & inventory management

- [ ] **A2.12 — A console rebook draft can't be edited or thrown away.** Since 16 Oct a draft the console made with "Rebook" can be booked ("Book this run", `bookDraftRun`); before that nothing moved it out of `draft` at all. Still missing: changing the draft's dates, and deleting a draft nobody wants. Also undecided: the member sees the desk's draft on their dashboard as "Not sent yet — finish it below and submit", and can submit it themselves (`resubmitAdvert` accepts their own `draft`) — fine if the desk meant it as an offer, wrong if it was the desk's working copy. → `src/app/console/adverts/[id]/page.tsx`, `src/app/dashboard/actions.ts` (`resubmitAdvert`)

**Closed:** A2.1 homepage takeover (was already built) · A2.2 featured-member booking · A2.3 bundles UI · A2.4 newsletter advert slots · A2.5 members see all their adverts · A2.6 visibility confirm raises an invoice · A2.7 invoicing on approval (since 6 Oct, fix-list 77, off the booking's own `price_pennies` — the rate card it used to read is gone) · A2.8 `news_mid` renders unconditionally · A2.9 `mpu` mobile artwork · A2.10 each banner position cycles its 3 in-page (decided 4 Oct, HUMAN-TODO §5.4; was random one-of-three per load) · A2.11 migration `set not null` guard.

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

- [ ] **A6.14 — Keyboard focus on the member directory can be dropped about a second after the page loads.** Found 16 Oct, verifying the review fixes; it predates them (no file involved changed). Focus a name in the logo cloud straight after `load` and, ~1.3s later, the page's own root `div` (`member/page.tsx`) is detached and re-attached under an unchanged `<main>`, which sends focus to `<body>` and hides the logo card. Established: the link, its list and `<main>` are the same elements throughout; there is no hydration error; `CloudRefine` only writes a stylesheet; the public layout is a server component; no client component refreshes the router on load. Not established: whether it happens outside `next dev` (the production-build check was abandoned, see HUMAN-TODO §28.13). `flows.spec.ts` "the logo is reachable by keyboard" fails about two runs in three because of it. → `src/app/(public)/member/page.tsx`, `src/components/CloudRefine.tsx`

**Closed:** A6.1 "Oldest" sort removed · A6.2 mobile nav · A6.3 Advertising under Media · A6.4 directory map view · A6.5 logo-led directory (the word-map default since 18 Sep ~~is with Jas, ask-jas §7~~: that question left ask-jas on 25 Sep, `97975e6`, with no answer recorded) · A6.6 pagination on directory/video/event/search · A6.7 search bar on home/news/video · A6.8 member-stories-only search filter · A6.9 member videos badged · A6.10 videos woven into /news · A6.11 cookie-settings link · A6.12 `link_url` override is as specified · A6.13 join CTA on /advertising.

### A7 · Platform & admin

**Closed:** A7.1 two roles is the intended model · A7.2 revenue from the live rate card (superseded 16 Oct: the figure now reads paid invoices, and counts only paying members — ask-jas 26) · A7.3 member ownership helpers · A7.4 silent `saveLayout` no-ops · A7.5 stalled-cron warning.

### A8 · New requirements from the 31 Aug refresh

- [ ] **A8.3 — Admin lead-generation panel (A29): waiting only on the disclaimer sign-off (ask-jas §15).** Built: the mock `LeadGenSource` adapter, `/console/leads` with search criteria, and call/email/sequence marks (`prospect_marks`). The 18 Sep guardrails (USE-CASES gap 24, TECH-DECISIONS #16) asked for prominent job titles and a mandatory "not vetted sales leads" disclaimer. Both were built 28 Sep (`5b2a9ad`): `Prospect.jobTitle` is shown bold on both panels, and one shared `LeadsDisclaimer` sits under the "Sample data" banner on both. Its text is a **draft** quoted in ask-jas §15. Closes when Jas signs off or rewords it, and the wording changes in one file. → `src/components/leads/LeadsDisclaimer.tsx`, `src/lib/adapters/leadgen.ts:41`, `src/app/console/leads/page.tsx`
- [ ] **A8.4 — Member lead-generation panel (M14): same state as A8.3.** `/dashboard/leads` runs on the same adapter and the same disclaimer component. → `src/app/dashboard/leads/page.tsx`
  **Correction (28 Sep):** "`lead_alert` still has no link target, waiting on this panel" was wrong. `lead_alert` counts `engagement_audit` rows (real companies engaging with the member's page, M7/M9), not the mock prospects shown here. It now links to `/dashboard/stats` in the notification feed, which is where its email's button already went. *(`5b2a9ad`.)*
  **Found and not fixed:** the lead-alert email says "See who's interested in your member area", but the "Who's engaging" list left `/dashboard/stats` in the 8 Sep rework (A5.5/A5.7). Today no member-facing page shows *which* companies engaged; the list exists only in the console. Either bring a company/region list back to the member area, or reword the email. That is a product call. → `src/lib/email/defaults.ts:505`

**Closed:** A8.2 site-wide design default: `settings.site_variant`, set from the "Homepage design" card on `/console/pages`. The switcher cookie is now only a preview (28 Sep; also fixed `flows.spec.ts` "admin block layouts" and its leftover-override flake). **Changed 5 Oct:** grid is the fallback when the row is missing, unrecognised or unreadable, and both seeds insert `grid`. A database whose row says `forge` stays forge until someone saves Grid, and forge stays covered by the a11y homepage scan, `home-hero.spec.ts` and `flows.spec.ts`'s hero/header tests · A8.1 members set their own membership types, capped at 6, approval-gated on live pages (28 Sep; also fixed `join.spec.ts` promo path) · A8.5 member page plays the company video then the member's published SMI videos, no new table (28 Sep; also added `i.ytimg.com` to the CSP `img-src`, with the first CSP test).

### A9 · New requirements from the 18 Sep call (USE-CASES gaps 19–26, REQUIREMENTS `[18 Sep]`)

Already done from this call, so no item: Industries pre-filter (gap 19; `industries` table since 10 Sep, `?industry=` on news/video/event/member, industries bar below the nav on grid) · event location + type (fix-list/A1.8) · in-dashboard help to Jas (`/dashboard/help`) · dropped card dates, bigger featured-member logos, "Become a Member" on the stats band, three-column grid fold with separated Featured Machine/Event (fix-list 64–68) · ad-format freeze (gap 25; `banner_narrow` hidden, fix-list 74) · reset-only password recovery (gap 22).

- [ ] **A9.11 — Nothing on the public site offers a member's email any more (V8).** V8 has readers contact a company "via website link, phone, or email", and `/go/[memberId]` still handles `kind=email` and counts `email_click` for member stats. But no page renders that link. The company page shows Website, Call and social links only. The directory card's Email link was removed in `97af6de`, the fix-list pass that simplified the cards. That was a requested change, so this is **not** being quietly reverted. The question is whether the company page should carry an Email button, which is one line beside Call. As things stand, the "Email" series in members' Clicks overview can only ever read zero. Asked in ask-jas §18. → `src/app/(public)/member/[slug]/page.tsx:146-147`, `src/app/go/[memberId]/route.ts:58`
- [ ] **A9.7 — The stats digest defaults on, but the 18 Sep call says opt-in. This is a spec conflict to confirm, not a build.** REQUIREMENTS §6 asks for an "opt-in periodic performance-summary email". USE-CASES M9 and gap 7 still say default quarterly, and the code does that: `?? "quarterly"` for members with no preference row. Flipping it is one line, but which document wins is Jas's call (ask-jas §16). → `src/lib/jobs.ts:520`
- [ ] **A9.9 — Nav order (REQUIREMENTS §4), grid only.** The call asked for the current site's order: a standard navbar (Home / News / Videos / Newsletters / Find a Member) beside the logo, with the Industries bar below it. **Grid is the design going live** (decided 5 Oct, ask-jas §17; it is the site default since A8.2's 5 Oct change), so this is now a buildable grid fix and forge is out of scope. On grid, Industries is correctly below, but `NAV_ITEMS` has no Home link and the nav sits in its own bar under the logo row. Moving it beside the logo changes the header on every public route, so every visual baseline moves (`pnpm visual`, human-accepted). → `src/components/GridSiteHeader.tsx:28-37`

**Closed (all 28 Sep, `5b2a9ad`):** A9.1 /member filters facet against each other (`src/lib/member-facets.ts`) · A9.2 "Content reach" by type, plus the `video_view` event and the `member_event_months` RPC that fixed silent under-counting past `max_rows`; social half waits on D5 · A9.3 member news woven into the grid's More News carousel (forge half moot, grid going live) · A9.4 Featured Machine video + seller logo · A9.5 `search_members()` matches services and industry · A9.6 FAQ grouped, policies collapsible, membership terms in the footer (prod push: HUMAN-TODO 19.1) · A9.8 member advertising Assets tab (baseline: HUMAN-TODO 19.3) · A9.10 videos YouTube-only, and `youtubeId()` reads every YouTube link shape. The production migrations for A9.2/A9.4/A9.5 shipped 1 Oct (HUMAN-TODO 19.4).

---

## Part B — Blocked on a third-party integration

Several closed B items were written against documented APIs and **have never run against a live account**. Confirm each on its first real use:

- Stripe checkout, subscriptions and cancel (B1.1, B1.5)
- Buffer GraphQL enums (B4.4)
- Resend Broadcasts/Contacts (B5.1) and its webhook fields (A5.4)
- Bigin push, pull, opt-out and webhook (B6.4–B6.8)

### B1 · Stripe (payments)

- [ ] **B1.7 — Checkout is a redirect, not an embedded modal (V13).** `StripePayments.createCheckout` creates a redirect-mode Checkout Session (`mode: "subscription"`, `success_url`/`cancel_url`, no `ui_mode`). `pay/actions.ts` does a full-page `redirect(payment.url)`. This needs Embedded Checkout or the Payment Element. → `src/lib/adapters/payments.ts:94-105`, `src/app/dashboard/pay/actions.ts`
  **Half done (6 Oct):** advertising invoices now pay through **embedded** Checkout (`ui_mode: embedded_page`, pinned to API `2026-03-25.dahlia`, Stripe.js loaded from js.stripe.com) on `/dashboard/pay/invoice/[id]` → `src/lib/adapters/advert-checkout.ts`, `src/app/dashboard/pay/invoice/[id]/EmbeddedCheckout.tsx`. Membership is still the redirect described above. Moving it over is the same component, but a subscription session plus the join funnel's promo-code path, so it's left for its own change. The CSP already allows Stripe. *(Committed in `4f14b9b`.)*

**Closed:** B1.1 `StripePayments` · B1.2 `getPayments()` branches on the key · B1.3 webhook + mock simulator · B1.4 failed payment → grace · B1.5 member-side cancellation · B1.6 moved to "What is solid" (standing constraint).

### B2 · GeoIP — MaxMind / GeoLite2

**Closed:** B2.1 fabricated region removed (GeoLite2 still unwired, see D2) · B2.2 stats say company resolution is parked.

### B3 · Email — Resend

- [ ] **B3.3 — ~~No key exists yet.~~ Key set in production; waiting on the sending domain.** All email is inert until an SMI-owned Resend account is created, the domain is verified (SPF/DKIM/DMARC) and `RESEND_API_KEY` is set. **5 Oct (Luiza):** `RESEND_API_KEY` is set in production and a test email went through. Domain verification is still to come (HUMAN-TODO 1.2). Until then, mail to anyone other than the Resend account owner is refused (403), so member, admin and auth mail is still effectively off. Creating accounts and sending real mail are approval-gated (`BUILD-PLAN.md`). See `.env.example`.
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

**Closed:** B5.1 Resend sender, the candidate under test (Jas's MailChimp deliverability gate still open) · B5.2 unsubscribe + webhook sync-back. **Hardened 16 Oct (code review):** typing an address on `/unsubscribe` no longer unsubscribes it — it emails that address an HMAC-signed link good for 72h, and only the confirm POST behind it applies the opt-out (`src/lib/unsubscribe.ts`; off until `UNSUBSCRIBE_SECRET` is set, HUMAN-TODO §28). The cost: someone without access to the inbox, or not yet a contact, can't use this page; the newsletter's own one-click link is unaffected · B5.3 issue preview, edit and video pick · B5.4 a repeat signup now opts a "not subscribed" contact back in through `applyOptIn`, and a failed update no longer claims success (16 Oct). **Found and fixed en route (16 Oct):** `syncContacts` only ever pushed the first 1,000 of ~2,700 subscribers (PostgREST row cap; reads are now paged), and never removed anyone from the Resend segment — it now prunes addresses that aren't subscribed contacts (old addresses after an email change, deleted and "not subscribed" contacts) and marks our unsubscribes unsubscribed there. If the segment can't be listed, nothing is removed. *(Committed in `65103f9`.)*

### B6 · CRM — Bigin / Zoho

**Correction (7 Oct):** ~~B6.1 and B6.3 closed~~ — both were written against **Zoho CRM's** API (`/crm/v2/Contacts`), not Bigin's (`/bigin/v2/Contacts`), and Bigin search needs a `ZohoSearch.securesearch.READ` scope HUMAN-TODO §7 never asked for. They would have failed on the first live call. Rewritten as B6.4–B6.8 below. The sync was also one-way: nothing new in Bigin ever came back, and an unsubscribe here never reached Bigin.

**Closed:** B6.1 `BiginCrmSync` (superseded by B6.4) · B6.2 public signup pushes to Bigin · B6.3 dedupe write-through + unsubscribe sync-back (superseded by B6.4/B6.5) · B6.4 push rewritten for `/bigin/v2`: whole-row push by contact id (`syncContactToCrm`), PUT by stored `bigin_id` so an email change no longer orphans the Bigin record, `Email_Opt_Out` pushed (cleared only on an explicit console re-opt-in), names sent on create or when edited here only, `trigger: []` so our writes fire no Bigin workflows, per-record 202 rejections treated as failures, and a failed push queues a `crm_push` retry and marks the row `crm_dirty_at` instead of throwing past the console action · B6.5 pull of new and edited Bigin contacts by `Modified_Time` cursor (`settings.crm_sync_cursor`), matched on `bigin_id` then email; opt-out wins both ways and a dirty row's profile fields aren't overwritten. **The first import (~2,700 contacts, subscribed unless opted out in Bigin) is never automatic** — it waits for "Preview import" → "Run first import" on `/console/crm`; the cost is one manual step on launch · B6.6 our unsubscribes reach Bigin: the unsubscribe page and the Resend webhook (unsubscribe, complaint, hard bounce) now push · B6.7 Bigin Notifications API webhook at `/api/webhooks/bigin` (token-checked, ids re-read from Bigin, deletes only unlink), channel renewed by `crm_sync`. Bigin channels last ≤1 day and production cron is daily (A3.1), so live updates have a short daily gap the poll covers · B6.8 Bigin company link (`contacts.bigin_company_id/_name`, migration `20261007000001`): auto-linked on an exact single name match, otherwise set with the console picker; companies are never created in Bigin. Also fixed en route: `sync()` stamped `last_synced_at` on contacts that had never been synced, so "Synced" in the console was false. → `src/lib/adapters/crm.ts`, `src/app/api/webhooks/bigin/route.ts`, `src/app/console/crm/page.tsx` *(Committed in `4f14b9b`. Never run against a live Bigin account — HUMAN-TODO 7.5.)* **Hardened 16 Oct (code review):** a stored `bigin_id` whose record was deleted in Bigin is confirmed gone with a GET and then unlinked and re-pushed, instead of failing every 15 minutes for ever · two near-simultaneous first pushes no longer leave a duplicate Bigin contact (the loser deletes its own) · one email clash no longer fails a whole pull batch · emails pulled from Bigin are lowercased (`20261016000034` normalises existing rows without merging) · the first import is refused server-side unless a preview was run within the hour · the mock routes need a deployment-derived key header. *(Committed in `65103f9`.)*

---

## Part C — Honesty fixes owed because Part B is unfinished

**Closed:** C1 stub refuses to "pay" in production · C2 invented region data removed · C3 failed newsletter sends surface as `send_failed` · C4 not a gap (copy is accurate) · C5 pay-page copy follows `paymentsAreLive()` · C6 consent undercount measured and disclosed (the underlying choice is D1); since 16 Oct obvious crawlers following `/go` and `/visit` links no longer feed the consent counters or click stats (`src/lib/bots.ts`; `/go/` is also disallowed in robots). Browser-faking mail scanners can't be told apart by user agent. *(Committed in `65103f9`.)*

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

- **The WordPress agency's liquidation and hosting takeover** (USE-CASES gap 26) is external and time-sensitive. → HUMAN-TODO §19.2.
- **Industries** became their own table, directly linked from stories, videos and events, on 10 Sep (migration `20260909000002`). On 12 Oct Jas's ten replaced ours and a member can be in several, with one primary (`20261012000001`, `member_industries`). Every assignment is backfilled from his mapping of Services and news topics (`scripts/lib/industry-map.ts`, `pnpm industries:backfill`); a story's industry is a snapshot, not a join. Production steps: HUMAN-TODO §26; open questions: ask-jas § Industries. *(Committed in `4f14b9b`.)*

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

- **D2 — Region (C2 / B2).** Wire GeoLite2 now, or ship without region until the MaxMind key is approved?
- **D4 — Unconfirmed spec gaps.** These items are built to the working assumptions in `USE-CASES.md` and are still unconfirmed:
  - **5, grace days before a lapsed page is hidden.** The code hardcodes **30** in two places, `src/lib/membership.ts:180` and `src/lib/jobs.ts:461`, with no shared constant.
  - **11, 13, 15** (skyscraper specs, the bundle label, featured-member rotation).
  - **24, the lead-gen disclaimer wording**, which blocks A8.3/A8.4.
- **D5 — How is "social media reach" calculated?** (REQUIREMENTS §26.) The grid homepage's membership-value band shows a hardcoded `SOCIAL_REACH = 347_000`, whose own comment says it has no source in the database. The same number blocks the social half of A9.2. → `src/components/grid-home/cards.tsx:513`

**Closed:** D1 consent vs. advertiser reporting, decided by Luiza 28 Sep: impressions are counted whether or not the reader accepted cookies (anonymous when declined) and never change what anyone sees; clicks and page views stay consent-gated (`5b2a9ad`; the Policies line is still open, ask-jas §19) · D3 advert click target (`link_url` legitimately overrides the member page, see A6.12).
