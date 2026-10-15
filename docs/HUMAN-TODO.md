# Human to-do — things Claude can't do

Actions that need a person: external accounts, DNS, hosted-dashboard settings,
restarting shared services, and decisions that are someone's to make. Everything
here is **blocking real behaviour** — the code for each item is written and
merged, but inert until the step is done.

Created 31 Aug 2026 alongside the Resend email work (`GAPS.md` B3, B5, C3,
A4.1). Add to it rather than starting a second list.

**Finished items are collapsed** (since 5 Oct 2026, as in `GAPS.md`). Each
section ends with a **Done:** line naming its closed IDs. The full notes,
including how each push was run and what was checked, are in git:
`git show ba9d35f:docs/HUMAN-TODO.md`. Items finished on 4–5 Oct were collapsed
before their notes were committed, so their Done entries carry the essentials.
Numbers are permanent and never reused. Only `fix-list.md` keeps ticked `[x]`
items; every other list collapses them.

> Creating external accounts, pushing code off-machine, deploying, **sending
> real email** and calling paid APIs are all explicitly approval-gated in
> [`BUILD-PLAN.md`](../../requirements/BUILD-PLAN.md). That is why these are
> parked here rather than done.

---

## 1 · Resend account and sending domain — blocks all email

Nothing in the app sends mail until this is done. Member notifications still
land in the `notifications` table and enquiries still land in the console inbox,
so **nothing is lost** — but nobody is told anything: no approvals, no advert
notices, no password reset, no newsletter.

Do these in order; later steps depend on earlier ones.

- [ ] **1.1 — Create the Resend account, owned by SMI.** Not an agency account:
      `TECH-DECISIONS.md:41` requires Vercel, Supabase, GitHub, Buffer and Resend
      to all end up SMI-owned. The free tier (3k emails/month) covers current
      volume.
- [ ] **1.2 — Verify the sending domain** for `sheetmetalindustries.com` and
      publish the **SPF, DKIM and DMARC** records Resend gives you. Until this is
      done every send returns 403 `validation_error`. The app surfaces that as a
      dead job in "Needs You Today" rather than failing silently, so you will see
      it — but it is better not to hit it.
- [ ] **1.3 — Verify a separate staging subdomain** (e.g. `staging-mail.`) and
      issue a **second, domain-restricted, sending-only** API key for it.
      Resend has **no sandbox or test-mode key** — a domain-restricted key on its
      own subdomain is the only real isolation, and it means a staging mistake
      cannot damage the production domain's reputation.
- [ ] **1.4 — Set the production env vars in Vercel** (production and preview
      scopes separately — preview should get the staging key from 1.3):

      ```
      RESEND_API_KEY=          # from 1.2 / 1.3
      EMAIL_FROM=              # e.g. "SMI <noreply@sheetmetalindustries.com>"
      EMAIL_REPLY_TO=          # a monitored inbox — see 1.5
      ADMIN_EMAIL=             # where enquiries and the daily digest go
      ```

      Full commentary on every variable is in [`.env.example`](../.env.example).
      **5 Oct 2026 (Luiza):** `RESEND_API_KEY`, `EMAIL_FROM` and `ADMIN_EMAIL`
      are set in production, and a test send worked. Still to do:
      `EMAIL_REPLY_TO` (1.5) and the preview-scope key (1.3). Not yet confirmed:
      that the account is SMI-owned (1.1). Still blocked on 1.2: without a
      verified domain, sends to anyone but the account owner are refused.
- [ ] **1.5 — Decide the reply-to address.** Without `EMAIL_REPLY_TO`, replies go
      to `noreply@` and reach nobody — including a member answering "your advert
      needs a change before it runs", which is a message that invites a reply.
- [ ] **1.6 — Smoke-test before pointing it at real people.** Send to Resend's
      test addresses, which exercise the real API and webhooks:
      `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`
      (labels work: `delivered+reset@resend.dev`). **They count against quota.**
      Do not use `@example.com` or `@test.com` — those bounce.

**Done:** 1.7 "Send a test" no longer inert: the key is set (1.4), so it sends for real, but only to the account owner until 1.2.

## 2 · Supabase — password reset delivery

- [ ] **2.1 — Set Resend SMTP in the *hosted* Supabase dashboard**, so auth mail
      (password recovery) leaves via Resend rather than Supabase's shared,
      rate-limited mailer:

      ```
      host: smtp.resend.com   port: 465   user: resend   pass: <RESEND_API_KEY>
      ```

      ⚠ **Do this in the dashboard, never in `config.toml`.** Per
      [`README.md`](../README.md), `supabase config push` would overwrite hosted
      auth settings with the local ones — `site_url = 127.0.0.1`,
      `enable_confirmations = false`, and a 2-emails/hour rate limit.
      **5 Oct:** the key now exists (1.4), but the sender address must be on a
      verified domain, so this still waits on 1.2.
- [ ] **2.2 — Raise the hosted auth rate limit.** The CLI default is 2 emails per
      hour, which is fine for the built-in mailer and far too low once real
      members are resetting passwords.
- [ ] **2.3 — Check `site_url` and the redirect allow-list in the hosted
      dashboard** point at the real domain and include `/reset/confirm`. These
      are separate from the local values in `config.toml` and were not touched —
      a recovery link is only as good as the allow-list that permits it.

## 3 · Newsletter — after §1

- [ ] **3.1 — Create the Resend Audience/Segment** that holds subscribers and set
      `RESEND_SEGMENT_ID`. Without it the newsletter falls back to the logging
      stub (and says so in the logs); issues are left unsent rather than being
      marked sent.
- [ ] **3.2 — Register the webhook** at `https://<domain>/api/webhooks/resend`
      and set `RESEND_WEBHOOK_SECRET`. Subscribe to contact updates, bounces and
      complaints. Without it the route fails closed with 503 and unsubscribes
      made at Resend's end never reach our `contacts` table — the list would go
      quietly stale, which is a compliance problem as much as a data one.
- [ ] **3.3 — Watch the first real send closely.** `ResendNewsletterSender` is
      written against Resend's *documented* Broadcasts/Contacts API but has never
      run against a live account. Resend moved contacts from
      `/audiences/{id}/contacts` to a global `/contacts` with segments, so
      confirm the request shapes on the first send. A failure is visible rather
      than silent — the issue goes to `send_failed` with the error stored, shown
      on the newsletter board and at the top of "Needs You Today".
- [ ] **3.4 — Confirm the advert creative choice with Jas.** Booked newsletter
      slots render the **mobile** artwork, since the email column is ≤600px and
      narrower on a phone. Reasonable, but it is Jas's rate card.
- [ ] **3.5 — Confirm Resend broadcast open tracking is actually on.**
      `ResendNewsletterSender.sendIssue()` (`src/lib/adapters/newsletter.ts`)
      posts to `POST /broadcasts` with no `open_tracking`/`click_tracking` field
      — whether Resend injects an open-tracking pixel by default per-account, or
      needs an explicit flag or a dashboard toggle, is unconfirmed. If it's off,
      `newsletter_issues.opens_count` (A5.4) silently stays at 0 forever, and so
      does the "Newsletter" series on the member stats page's Advert-impressions
      chart (`/dashboard/stats`). Same "confirm on first live send" caution as
      §3.3.

## 4 · The deliverability gate — still open

Resend is wired for the newsletter **as the candidate to test with, not as the
decision**. Jas's gate stands: if MailChimp beats it on corporate-firewall
penetration and open rates, MailChimp wins and we keep it
(`DESIGN-QUOTES.md:941-951`, `05-platform-layer.md:11`). The `NewsletterSender`
adapter exists so that outcome costs one class, not a rewrite.

- [ ] **4.1 — Run the actual test**, once §1 and §3 are done. It needs a real
      send to real trade addresses behind real corporate mail filters — a
      `@resend.dev` smoke test cannot answer it. Compare against MailChimp on the
      two things Jas named: **does it get through the firewall**, and **open
      rates**.
- [ ] **4.2 — Take the result back to Jas**, and only then amend
      `TECH-DECISIONS.md` #7 from "candidate under test" to a decision. If
      MailChimp wins, the work is a `MailchimpNewsletterSender` behind the same
      interface — nothing else in the app changes.

## 5 · Decisions for you (small, but not mine to make)

- [ ] **5.1 — `tests/e2e/join.spec.ts` may not pass as a whole run.** It signs up
      several times against `allowRequest("join", 3, HOUR)`
      (`src/app/(public)/join/account/actions.ts:34`). Either the spec drops a
      signup or the limiter changes, and the limiter is a security control, so
      that is a real choice. **5 Oct:** the second half of this item, the
      `console-members.spec.ts` route typo, is fixed (it uses
      `/console/members/`), and GAPS A8.1 (28 Sep) reports that spec passing in
      full and join's promo path passing. Whether the whole join spec passes in
      one run under the limiter has not been re-checked.
- [ ] **5.2 — `CRON_SECRET` is not set locally.** `/api/cron` fails closed with
      503 and `scripts/job-runner.ts` refuses to start, so no background job —
      and therefore no email — runs locally without it. Add it to `.env.local` if
      you want the local queue working.
- [ ] **5.5 — Confirm the lapsed-member backlink policy (`GAPS.md` A4.4).** When
      a member lapses, their published stories now stay live with the
      SMI-directory backlink hidden (rather than unpublishing the story) —
      implemented as a working assumption, not a confirmed product decision.
      Confirm with Jas whether a lapsed member's content should stay live at
      all, or come down with them.
- [ ] **5.6 — Upload real brand-pack assets (`GAPS.md` A4.16).** `/console/resources`
      is live but starts with zero rows — logo variants, brand guidelines, or
      whatever else should be in the member resources library needs sourcing
      and uploading through the new console page before `/dashboard/resources`
      shows anything beyond the existing generated "proud member" graphic.

**Done:** 5.3 console inbox exists (`/console/messages`) · 5.4 advert rotation decided 4 Oct: an **in-page carousel**. Each banner position cycles its 3 adverts every 6 s on one shared timer (`src/components/AdCarousel.tsx`), pausing on hover/focus, and each frame counts its own impression after 1 s on screen. That raises impression figures (23.2).

## 6 · Stripe — blocks real payments

The code is written and merged (`GAPS.md` B1.1–B1.4) but inert until this is
done. Without it, `/dashboard/pay` still simulates a paid subscription with
nothing charged — the copy now says so honestly (C5), but no money moves.

- [ ] **6.1 — Create the Stripe account, SMI-owned** (`TECH-DECISIONS.md:41`).
      Create the £40/mo subscription Price and note its id.
- [ ] **6.2 — Register the webhook** at `https://<domain>/api/stripe/webhook`,
      subscribed to `checkout.session.completed` and `invoice.payment_failed`,
      and set `STRIPE_WEBHOOK_SECRET` from what Stripe gives you. Without it
      the route fails closed with 503 and no payment or failed-card event ever
      reaches `applyPaymentResult`/`applyPaymentFailure`.
- [ ] **6.3 — Set the production env vars in Vercel** (production and preview
      scopes separately):

      ```
      STRIPE_SECRET_KEY=       # test mode key first
      STRIPE_PRICE_ID=         # from 6.1
      STRIPE_WEBHOOK_SECRET=   # from 6.2
      ```

      Full commentary on every variable is in [`.env.example`](../.env.example).
- [ ] **6.4 — Watch the first real payment closely.** `StripePayments` and
      `/api/stripe/webhook` are written against Stripe's *documented* API but
      have never run against a live account — the invoice-to-member-reference
      lookup in particular (`webhook/route.ts`'s `memberIdFromSubscription`)
      depends on a field whose shape has moved between Stripe API versions.
      Confirm with a real test-mode subscription and a real declined card
      before trusting `invoice.payment_failed` in production.
- [ ] **6.5 — Enable `MOCK_INTEGRATIONS=1` on the Vercel Preview environment
      scope only, never Production.** This redirects the adapter above to
      `/api/mock/stripe/*` on the same deployment (see `.env.example` and
      `lib/adapters/mock-base-url.ts`), so a Preview build can be paid for and
      declined without touching the real Stripe account.
- [ ] **6.6 — TECH-DECISIONS #16 constraint (`GAPS.md` B1.6):** whatever
      Stripe subscriptions already exist from the old site must never be
      touched by this integration. Confirm nothing here reaches them before
      going live.

## 7 · Bigin/Zoho CRM — blocks the two-way contact sync

The code is written (`GAPS.md` B6.4–B6.8, 7 Oct) but inert until this is
done. Without it, contacts only live in the app's own `contacts` table —
nothing is lost, but Bigin never hears about a new contact or an unsubscribe,
and nothing added in Bigin shows up here. Order matters: **7.6 before the code
is deployed, 7.7 before the next newsletter goes out.**

- [ ] **7.1 — Create the Bigin account, SMI-owned**, and register an OAuth
      client (client id + secret) in the Zoho API console.
- [ ] **7.2 — Generate a refresh token** with a **Self Client** in the Zoho API
      Console (Generate Code tab → portal **Bigin** → the SMI org), then
      exchange the code (`grant_type=authorization_code`) for a refresh token
      and set `BIGIN_REFRESH_TOKEN`. Scopes, comma-separated:

      ```
      ZohoBigin.modules.contacts.ALL,ZohoBigin.modules.accounts.READ,ZohoSearch.securesearch.READ,ZohoBigin.notifications.ALL
      ```

      `ZohoSearch.securesearch.READ` is easy to miss and every duplicate check
      fails without it. Zoho access tokens expire hourly; the refresh token is
      what makes this unattended. The code lives 3–10 minutes, so exchange it
      straight away.
- [ ] **7.3 — Confirm the account's data centre** and set `BIGIN_ACCOUNTS_BASE`
      / `BIGIN_API_BASE` accordingly if it isn't the EU one
      (`accounts.zoho.eu` / `www.zohoapis.eu`, the defaults) — Zoho pins an
      account to a data centre at creation and the wrong host rejects every
      call. Each data centre also has its own client secret. Canada's
      accounts host is `accounts.zohocloud.ca`.
- [ ] **7.4 — Set the production env vars in Vercel**:

      ```
      BIGIN_CLIENT_ID=
      BIGIN_CLIENT_SECRET=
      BIGIN_REFRESH_TOKEN=     # from 7.2
      BIGIN_ACCOUNTS_BASE=     # only if not the EU default
      BIGIN_API_BASE=          # only if not the EU default
      BIGIN_WEBHOOK_TOKEN=     # any random string ≤ 50 chars, e.g. `openssl rand -hex 24`
      ```

      `BIGIN_WEBHOOK_TOKEN` switches on live updates from Bigin
      (`/api/webhooks/bigin`). Without it everything still syncs, just only
      when `crm_sync` runs — which is **once a day** while production cron is
      daily (GAPS A3.1, §13.1).
- [ ] **7.5 — Watch the first real run closely.** `BiginCrmSync` is written
      against Bigin's *documented* v2 API but has never run against a live
      account. On the first push (add a contact in `/console/crm`) and the
      first import (7.7), check:
      - the contact appears in Bigin with the right name, company and
        email opt-out;
      - the duplicate check works: adding a contact Bigin already has must
        update it, not create a second one;
      - a contact who unsubscribes here shows as *Email Opt Out* in Bigin;
      - after the first sync with `BIGIN_WEBHOOK_TOKEN` set, the "Last sync"
        line on `/console/crm` doesn't report a *live updates* error, and an
        edit made in Bigin shows up here within a minute or so.

      Unconfirmed in Bigin's docs, and written defensively: whether search
      answers "no match" with 204 or an empty list (both handled); whether
      `Unsubscribed_Time` is filled alongside `Email_Opt_Out` (used as the
      opt-out date when present); whether re-registering the same webhook
      channel needs the update call (the code tries create, then update).
- [ ] **7.6 — Push `20261007000001_contacts_bigin_sync.sql` to production
      before deploying this code** (`pnpm db:push:prod`, or `supabase db push
      --linked` as in 19.4). It only adds four nullable columns and an index to
      `contacts`, but `/console/crm` and every push read them, so the code
      without the migration breaks the CRM page and every contact write-through.
- [ ] **7.7 — Run the first import from `/console/crm`, with Jas, before the
      next newsletter send.** Nothing is pulled from Bigin until someone does:
      click **Preview import**, read the counts (how many would be added, how
      many are opted out in Bigin, how many have no email or are duplicates),
      then **Run first import**. Imported contacts are **subscribed unless
      they opted out in Bigin** — that mirrors today's Bigin → MailChimp list,
      but it means subscriber counts jump, the daily `newsletter_sync` copies
      them into Resend, and the next issue goes to them. If Bigin still feeds
      MailChimp, our unsubscribes now reach MailChimp through it too.

---

## 8 · Security hardening (1 Sep) — production follow-through

The pre-delivery security pass closed several holes locally; two of the fixes
are inert in production until these steps run.

- [ ] **8.2 — Create the private `invoices` bucket in the hosted Supabase
      dashboard** (Storage → New bucket → name `invoices`, public **off**).
      New invoice PDFs upload there; without the bucket, PDF generation fails
      soft (invoice rows still record, `pdf_path` stays null).
      **5 Oct, probably already done, not checked in the dashboard:** the
      24 Sep full `seed:prod` into the new project runs
      `createBucket("invoices", { public: false })` (`scripts/seed-real.ts:895`)
      on the same path that created `media`, which demonstrably exists. One
      look at Storage in the dashboard closes this.
- [ ] **8.4 — CSP nonce migration stays deferred** (documented in
      `next.config.ts`): `script-src 'unsafe-inline'` is accepted for now.
      When the nonce work happens, the JSON-LD `<script>` tags added for SEO
      must carry the nonce too.

**Done:** 8.1 `20260901000014` lock-down migration applied (1 Sep) · 8.3 moot: it was about the old project's `media` bucket, and the new project (§17) was imported fresh.

---

## 9 · Member-area rework (3 Sep) — production follow-through

**Done:** 9.1 `members.testimonials` dropped on production (6 Sep).

---

## 10 · Fix-list pass (3 Sep) — production follow-through

- [ ] **10.4 — Upload real example images for the six advert formats** at
      `/console/adverts/spots` (new per-format upload). Cards on `/advertising`
      show no image until one is uploaded.

**Done:** 10.1 three migrations applied (6 Sep) · 10.2 FAQ/terms/Policies seeded: overtaken by the 24 Sep full `seed:prod`, which upserts every authored static page (`seed-real.ts:1222`); the 28 Sep copy still needs 19.1, and the terms-page warning has moved there · 10.3 folded into 19.1 (the authored Policies row is now `collapsible: true`) · 10.5 event map pins · 10.6 "For you" consent gate noted · 10.7 member-profile layout without adverts · 10.8 real news topics on production: overtaken by §12 (44 categories from WordPress tags) and §22 (pruned to 36).

---

## 11 · Visual regression suite (9 Sep) — decisions for you

The suite is built and working (`tests/visual/`, `pnpm visual`). 79 baselines are
committed. Baseline reviews from later passes are gathered in 19.3.

- [ ] **11.2 — Plain git or LFS for the baseline PNGs.** `tests/visual/baseline/`
      is **24 MB** (79 full-page PNGs plus their element maps), and git keeps
      every generation forever. Plain git is fine for now and is what is set up.
      If re-baselining becomes frequent, LFS is the alternative — but it adds a
      tool every clone and CI checkout needs. No action needed today; just know
      the number.
- [ ] **11.3 — Six routes have no coverage because the local database has no
      content for them**, and they are marked `skip` with a reason in
      `tests/visual/manifest.ts`: the four member submission editors
      (`/dashboard/{story,video,event,equipment}/[id]/edit` — member1 has no
      submissions), `/console/newsletter/[id]` and `/console/adverts/bundles/[id]`
      (the indexes are empty), plus `/newsletters/[slug]`. A seed that creates
      one of each would let them be unskipped and pinned. Not urgent — they are
      listed in every report, so they cannot be forgotten.

Also worth knowing: **a reseed invalidates every baseline** (they are photographs
of specific content). That is expected — run `pnpm visual`, look, then
`pnpm visual:accept --changed`.

**Done:** 11.1 first baselines reviewed and accepted by Luiza, 22 Sep (`54a6d84`).

---

## 12 · Industries refactor (10 Sep) — production follow-through

Industries became their own table and content gained a direct `industry_id`
(migration `20260909000002`). **Done on production, 22 Sep**; before re-running
any of it, read the full notes in git. Two lessons from that run:
- **A `--dry-run` predicts 455 `member_services`, and the live pass produces 483.**
  That's correct behaviour, not a shortfall.
- **`automation-robotics` is in both `industries` and `services`**, under slightly
  different names, so the Services vocabulary carries a term that is also an
  industry facet. That question has since left ask-jas (it was §11).

**Done:** 12.1 industries migration applied (22 Sep, backup first; three other pending migrations went with it) · 12.2 taxonomy backfill run (114 of 123 members with an industry, 483 `member_services`, 90 `member_membership_types`). · 12.3 and 12.4 superseded 12 Oct by §26: the industries and the mapping are now Jas's, and stories take an industry from their news topics too (that was 12.4's "revisit the decision"), so content is no longer almost empty.

---

## 13 · Fix-list pass (13 Sep) — production follow-through

- [ ] **13.1 — Decide the production cron schedule.** `vercel.json` runs
      `/api/cron` **once a day at 03:00** (`"schedule": "0 3 * * *"`). Everything
      the job queue does inherits that delay in production: member notifications
      and their emails, scheduled publishing, social pushes, and all ten daily
      sweeps. A video approved at 10am notifies the member at 03:00 the next
      morning; a story scheduled for 10am goes live the next night.

      This is what produced fix-list item 49 ("member did not get notified of
      video approval") — the notification was correct and queued, it just ran
      about 21 hours later. Note `src/lib/jobs.ts:8` already documents the
      intended behaviour as *"Prod: Vercel Cron hits /api/cron every minute"*,
      so the code comment and `vercel.json` currently disagree.

      **To change it:** set `"schedule": "* * * * *"` in `vercel.json` and
      redeploy. **Before doing that, check the Vercel plan** — Hobby permits
      only one cron invocation per day, which is very likely why it is set this
      way; per-minute needs Pro. Decide with Jas whether the notification delay
      justifies the plan, or whether a middle cadence (hourly, `"0 * * * *"`) is
      enough. Left unchanged deliberately: it is a hosting-cost and deploy
      decision, not an engineering one.
      **28 Sep:** still held. Luiza is not sure which plan the project is on,
      so `vercel.json` is unchanged (GAPS A3.1). First step: check the plan in
      the Vercel dashboard.

      Local development is unaffected either way — since 13 Sep a due job runs
      as soon as the response is sent (`runDueJobInlineInDev`), so the member
      area reflects an action immediately without `scripts/job-runner.ts`. That
      runner is still needed locally for the time-based sweeps.

---

## 14 · Grid homepage restyle (16 Sep) — decisions for you

The `grid` design's homepage was moved onto the palette from the designer comps
(`docs/Sheet Metal Industries Home v1.png` / `v2.png`), with its own light
header and footer. Code-complete; these two need a person.

- [ ] **14.1 — Confirm the social-reach figure, or drop the stat.** The closing
      stats band shows three numbers. Two are real and live: published articles
      (the count already returned by `publishedStories`) and member companies
      (`memberCount`). The third, "social media reach", has **no source in the
      database** — it ships as `SOCIAL_REACH = 347_000` in
      `src/components/grid-home/cards.tsx`, taken from comp v1's artwork. Either
      give me the real number (and say whether it should be editable, which
      needs a `settings` row and a console field), or say drop it and the band
      becomes two stats. It is presented to readers as fact today, so this is
      worth answering before the design goes anywhere near production.
      **5 Oct:** grid is the design going live, so this is now due. Same
      question as `GAPS.md` D5.
- [ ] **14.3 — Ten advert positions are still removed from the homepage.**
      The 16-17 Sep layout passes took out both side rails and then, at the
      client's direction, the holding row and the supplier-logo band that had
      been carrying their contents. The grid homepage has **three** advert
      positions — `home_1`, `home_2` and `home_3`, all of them the full-width
      1280×170 banner — and nothing else. Still gone from the page: the
      eight `home_rail_1…8` logo slots, the `home_mpu_1` box, the supplier-logo
      wall, and — new since 18 Sep — `home_2_narrow`, the one-day-old narrow
      slot that `home_2` replaced again (fix-list 64, and see §14.5). They
      render nowhere and report no
      impressions (`components/AdCreative.tsx` → `/api/seen`), so **a live
      booking against any of them shows a reader nothing today**. The inventory
      has to come back somewhere, or be withdrawn from sale. Worth knowing
      while deciding: `home_rail_1…8` were never registered in `advert_slots`
      (no `cap` row, no presence in `/console/adverts/spots`) — they existed
      only as string literals in the view, so this is also the moment to decide
      whether they should be real, capped slots.
      `tests/unit/home-grid.test.tsx` asserts the current three so the count
      cannot drift unnoticed.
      **Partly closed 17 Sep:** the **featured-member placement is back**, as
      the "Featured members" box down the left of the Latest videos band
      (fix-list 61). A live `featured_member` placement renders again. ~~Note it
      is a static list, not the carousel that `src/lib/visibility-products.ts`
      and the rate card both promise — see §14.6.~~ It became a real carousel on
      20 Sep (14.6).
      **4 Oct, narrows this item:** bookings are now dealt **by format, not by
      slot** (`liveBookings()` in `src/lib/adverts.ts`), so a `banner` booking
      renders in every banner position on the site. What remains is formats
      with no position on any page, such as the rail logos, the MPU and
      `banner_narrow` (14.5): a booking in one of those still shows a reader
      nothing. Which formats render on non-homepage routes was not re-checked
      on 5 Oct.
- [ ] **14.4 — "Featured event" is editorial, not sellable.** The new second
      placement card on the fold shows whichever event `upcomingEvents()`
      returns first. It cannot be booked: `placement_kind`
      (`supabase/migrations/20260808000002_commerce.sql`) has `featured_member`,
      `featured_machine`, `grid_block` and `takeover` but no `featured_event`.
      The client's wireframe labels that position "Advert — Featured Event". If
      it is meant to be sold, it needs a new enum value and console support —
      say the word and I will write the migration.
- [ ] **14.5 — Do not sell the 830×170 banner: it renders nowhere.** This item
      used to ask you to publish the narrow artwork spec. **It is withdrawn** —
      on 18 Sep the client asked for every homepage banner to be the same size,
      so the grid homepage's second position went back to the full-width
      `home_2` slot (fix-list 64) and nothing on the site renders
      `banner_narrow` any more.
      What is left behind, all of it live in the database and the console:
      the `banner_narrow` value in the `advert_format` enum and the
      `home_2_narrow` row in `advert_slots`
      (`supabase/migrations/20260917000001`); the "Banner — narrow (830×170
      desktop / 370×280 mobile)" option in the console's advert and spot
      pickers; a `banner_narrow` advert and a "Homepage banner (narrow)"
      product in both seeds; and £650/month in `ADVERT_FORMAT_PENNIES`
      (`src/lib/pricing.ts`). None of it was ripped out, because ~~a Postgres
      enum value cannot be dropped cleanly~~ the format may yet find a home.
      **Correction (4 Oct):** `adverts.format` is a text column with a CHECK
      constraint (`20260917000001`), not an enum, so `banner_narrow` *can* be
      dropped by a migration that rewrites the constraint. **Update (4 Oct):**
      the `home_2_narrow` row is gone with the whole `advert_slots` table
      (`20261004000002_banner_spots.sql`, §23.1). The format half is unchanged.
      Two things for a person:
      **(a) A booking against `home_2_narrow` shows a reader nothing.** Same
      problem as §14.3's removed slots. Nothing has been sold against it as far
      as the code can tell, but check before assuming.
      **(b) Decide whether it goes or stays.** If it stays, it needs a position
      on a page; if it goes, say so and I will strip the console options, the
      price, the seed rows and the slot row in one pass. It never reached the
      public rate card (`DEFAULT_AD_FORMATS` in `src/lib/advert-formats.ts`
      still offers "Desktop 1280×170px" only) and it was never on the member's
      own advert form, so no advertiser has been told the size exists — which
      makes this cheap to reverse in either direction, today.

**Done:** 14.2 `home@grid` baseline accepted 22 Sep (`54a6d84`); later moves are in 19.3 · 14.6 Featured Member is a real carousel on grid, and the cap went 4 → 8 (`FEATURED_SLOTS`, a commercial call worth confirming). Its "forge unchanged" caveat is moot now grid is going live; the "higher directory ranking" half of the product is still unchecked.

---

## 15 · Buffer social posting (17 Sep) — blocks every auto-post

The publisher was ported off Buffer's v1 REST API, which has been closed to new
developer credentials since 2019, onto their current GraphQL API (`GAPS.md`
B4.4). The code is written and tested; nothing has ever run against the real
Buffer, because no key has ever existed. Until these are done, every scheduled
story and video still publishes on the site but its social push only logs.

- [ ] **15.1 — Create the Buffer API key.** Buffer → Settings → API. **Only an
      organisation owner can create one** — a member account will be prompted to
      switch orgs and cannot proceed. Set it as `BUFFER_ACCESS_TOKEN`. Note this
      is a *personal API key* on the current API, not a v1 developer app
      credential; those are the ones Buffer stopped issuing, which is why the
      old code path could never have worked. Quota is per plan (Free: 3,000
      requests / 30 days) and we spend one request **per channel per post**, so
      three posts a day across two channels is ~180/month.
- [ ] **15.2 — Set the channel ids** at `/console/stories` → "Buffer channels".
      Until this is filled in, the adapter fails closed on every post by design.
      ⚠ If that field already shows a warning about "v1 profile ids", the stored
      values are from the old API and must be replaced — we deliberately do not
      convert them, because a v1 profile id and a GraphQL channel id are not
      known to be the same value and guessing could post to the wrong account.
- [ ] **15.3 — Confirm two enum literals against the live schema**, by
      introspection or one test post. `SHARE_MODE` and `SCHEDULING_TYPE` at the
      top of `src/lib/adapters/social.ts` are currently `"shareNow"` / `"custom"`
      and are **unverified**. They must mean *post now*: our own job queue
      already applies the +30 min delay and the daily cap, so a queue-shaped
      mode would stack Buffer's scheduling on top of ours, break the "posted
      ~30 min after publish" expectation, and make the cap accounting fiction.
      A wrong literal here is the one failure mode the tests cannot catch.
- [ ] **15.4 — Check the first real post's image actually rendered.** Media is
      passed as a public URL, not an upload. In production that resolves to the
      Supabase public `media` bucket and should be fine; locally it resolves to
      `127.0.0.1` and will legitimately fail, which is not a bug.

---

## 16 · Fix-list pass (23 Sep) — production follow-through

Both of this pass's migrations are on production: 19.4's `migration list` on
1 Oct showed none pending. The two post-push checks below were never recorded
as run.

- [ ] **16.2 — Know that `20260923000002` REPLACES an RLS policy.** It drops and
      recreates `public_read_active_members` so it also requires
      `archived_at is null`. That policy is the only thing standing between anon
      and the whole `members` table (`20260808000006_grants.sql` grants anon full
      DML), so if the push half-applies, check the policy exists before assuming
      the site is fine. Verify after pushing:
      `select polname from pg_policy where polrelid = 'members'::regclass;`
- [ ] **16.3 — The inbox backfill is text-matched and runs once.** It reclassifies
      existing `inbox_messages` rows into `message` / `notification` by matching
      the eight machine-written message bodies. It ran clean locally (132 rows
      reclassified, real messages untouched), but production has different rows.
      **After pushing, check nothing real was misfiled** — anything unmatched
      stays a `message`, which is the safe direction, so the failure mode is a
      stray notice in the inbox, not a lost enquiry:
      `select category, kind, count(*) from inbox_messages group by 1,2;`

**Done:** 16.1 `20260923000001`/`000002` on production (confirmed by 19.4's migration list, 1 Oct) · 16.4 folded into 19.3.

---

## 17 · WordPress migration to the new project (24 Sep) — production follow-through

The full export was imported into the new Supabase project
(`bvyxeujhecxulzwvpxfr`): 123 members, 1,992 stories, 387 videos, 53 events,
2,643 media objects. Verify any of it with `pnpm verify:prod`, which compares the
live database against `handover-extract/seed/` and names every difference.

- [ ] **17.2 — Storage buckets exist only in the seed script, not in a
      migration.** `media` (public) and `invoices` (private) are created by
      `seed-real.ts` at lines 893-895. A schema-only deploy — `db:push:prod` with
      no seed — leaves a project with no buckets and every image 404ing. There
      are also no storage RLS policies anywhere in the repo. Worth deciding
      whether bucket setup should become a migration rather than staying
      tribal knowledge in a seed script.
- [ ] **17.6 — Redeploy Vercel from `97975e6` or later.** That commit carries
      the PGRST201 fix — `story_members` had made every `member:members(...)`
      embed on a stories query ambiguous, which rendered the news page empty
      with no error anywhere, because `queries.ts` discards `error` on every
      read. Until the deployment is rebuilt from it, the live site is still
      serving the broken embed. The same commit adds request logging, so any
      remaining fault will name itself in the Vercel runtime logs rather than
      showing as blank content.
- [ ] **17.8 — Decide how `handover-extract/` gets version-controlled.** It is
      not a git repository and never has been, so the extraction pipeline — the
      code that decides what the migration actually produces — exists only on
      one disk with no history. This session added the `link_a_member`
      unserialization, the event-type mapping, a vitest harness and a golden
      fixture there, all unversioned. If it gets a repo, `json/` and `seed/`
      should stay ignored: they hold member contact details and full article
      bodies, and git history is forever.
      **Update (27 Sep):** the extract now also has an adverts step (17.11) and
      two new tested helpers in `scripts/lib.ts` — more unversioned pipeline.
- [ ] **17.11 — Import the old site's real adverts, then have Jas approve them.**
      Run `pnpm seed:prod -- --legacy-adverts-only` (idempotent — a re-run
      imports nothing; no backup needed, it only inserts). The inventory was
      never migrated because it lives in `wp_options` as an ACF options page,
      where the extract never looked; it is now extracted to
      `handover-extract/json/adverts.json` and shaped to `seed/adverts.seed.json`.
      What it creates, per Luiza's decisions on 27 Sep:
      - **9 in-date runs → `awaiting_approval`** — 5 banners (Prima Power,
        Compass, Bruderer, Greenfield, MMMA) and 4 supplier logos (White Cross,
        Bystronic, Yorgrip, Greenfield). Nothing renders until Jas approves each.
      - **4 lapsed runs → artwork only, no booking** — Kerf, Bystronic and HPC
        Laser banners (ended 31 Aug–2 Sep) and the Prima Power logo (2 Sep).
        Rebookable from the artwork page without chasing files.
      - **No product linked**, so approval raises **no invoice** — these were
        paid for on the old system.

      Before Jas approves, three things worth knowing: **approval emails the
      member twice** ("scheduled", then "live" from the sweep) about an advert
      they believe never stopped; **White Cross, Yorgrip and HPC Laser are
      lapsed members**; and the White Cross and Yorgrip "logos" are really
      560×300 newsletter banners someone put in the logo slot on the old site,
      so they will look wrong in the logo band. Not imported: slot B's two
      featured members (both ended 5 Aug) and slot C's Durma takeover (ended
      12 Nov 2025) — `placements` has no approval state to hold them anyway.
      After the run, `pnpm verify:prod` should show `legacy adverts imported
      13 / 13`.
      **Import done 27 Sep 2026** — 13 adverts, 9 bookings awaiting approval,
      21 artwork files; re-run imports 0; `verify:prod` shows 13 / 13 and media
      2664 / 2664. **Left open for the approval half:** the 9 are in the Command
      Centre's pending-adverts list for Jas.
- [ ] **17.12 — Delete the two manual test logins before launch.**
      `admin@smi.test` (role=admin) and `member@smi.test` (role=member, owning
      the draft company `smi-test-company`) were created on production on
      27 Sep at Luiza's request, via `pnpm accounts:test:prod`. They share one
      known password, so the same objection as 17.1 applies — the difference is
      that these are deliberate and currently in use.
      `pnpm audit:test-rows` deliberately does **not** match them: its patterns
      cover `@test.local` and `@smi.local`, not `@smi.test`, so `--delete`
      cannot sweep away accounts someone is testing with. That safety is why
      they need removing by hand instead. The company row is `draft`, so it
      stays out of the public directory, search and sitemap in the meantime.

**Done:** 17.1 the five `@smi.local` fixture logins (including the admin whose password is in the repo) are gone from `bvyxeujhecxulzwvpxfr`, confirmed by Luiza 5 Oct; this settles the 27 Sep "still open" note, and production auth holds only 17.12's two accounts · 17.3 paid Supabase plan (24 Sep) · 17.4 CLI reaches the new project: `supabase/.temp/project-ref` is `bvyxeujhecxulzwvpxfr` and 19.4's `db push --linked` worked with `SUPABASE_ACCESS_TOKEN` from `.env.production.local`. The stored login may still be the old account, so still **don't `supabase logout`** · 17.5 legacy event types (25 Sep) · 17.7 folded into 19.3 · 17.9 77 test rows the suites wrote to production removed (27 Sep; `tests/setup.ts` now refuses remote targets) · 17.10 SAMPLE adverts and the invented rate card removed (27 Sep): Jas must enter real products in `/console/adverts/spots` before a booking can carry a price. *(Superseded 6 Oct, fix-list 77: there is no rate card any more — the price goes on each booking, see §24.1.)*

## 18 · Admin release notes (28 Sep) — for you

`/console/releases` ("What's new", in the admin account menu) renders
`src/content/release-notes.md`. Members never see the link and are bounced
from the page.

- [ ] **18.1 — Review the first four entries' wording before it ships.** They
      were drafted from the 20–25 Sep commits in plain language for Jas; check
      nothing reads as a promise you don't want to make.
- [ ] **18.3 — Add an entry with each deploy.** Nothing generates it. The
      format is in the comment at the top of the file, and a malformed edit
      fails `pnpm check` (`tests/unit/release-notes.test.ts`).

**Done:** 18.2 folded into 19.3.

## 19 · GAPS A8/A9 pass (28 Sep) — production follow-through

- [ ] **19.1 — Push the regrouped FAQ and collapsible policies with the same
      `--pages-only` run as 10.2.** The FAQ is now grouped under Membership /
      News / Members / Events / Advertising / Account, with seven new answers
      (social sharing, YouTube-only videos, how readers find you, what's on a
      company page, how page edits are reviewed, listing an event, exhibiting
      at a show). Policies and Membership terms now open as collapsible
      sections. **Two warnings.** First, the run overwrites any edit made to
      these pages in `/console/content-pages` since the last run, because the
      authored copy wins on slug. Check the console first and fold any real
      edits back into `scripts/lib/static-page-content.ts`. Second, the terms
      pages (`terms`, `membership-terms`, `advertising-terms`) carry six
      `[SMI TO CONFIRM]` markers (VAT, registered company details, refunds,
      artwork deadline, advertising cancellation, governing law), and they render
      **verbatim on the live page**. The FAQ itself carries none, and a test
      keeps it that way.
      **5 Oct, inferred from code, not checked on production:** the terms pages
      are **probably already on production with those markers.** The 24 Sep
      full `seed:prod` upserts every authored static page, not just under
      `--pages-only` (`scripts/seed-real.ts:1222`). Since 28 Sep the footer
      links `membership-terms` on every page. The markers are still in the
      source today, and the questions behind them were in ask-jas §9, which
      left that file on 28 Sep with no answers recorded. Check
      `/pages/membership-terms` on whatever production serves before launch.
- [ ] **19.2 — The WordPress agency's liquidation and hosting takeover
      (USE-CASES gap 26).** It's external and time-sensitive, and nothing in
      this repo can do it. Hosting has to move out of the agency's fee
      (estimated £30–70/month, and Jas wants a fixed plan). The staffer posting
      ~10 stories a week can only cover the next 1–2 months. Terms depend on
      Jas's follow-up call with the agency.
- [ ] **19.3 — Look at the moved visual baselines.** Every public route's
      footer gained a "Membership terms" link, and the FAQ, Policies and
      Membership terms pages changed shape. So did the member company page
      (video section), `/featured-machine` (video + seller logo), both lead-gen
      pages (job titles, disclaimer), `/dashboard/advertising/*` (a fourth tab)
      and `/console/pages` (Homepage design card). `/dashboard/advertising/assets`
      is a **new** route with no baseline at all, so `pnpm visual` exits 2 on it
      until someone looks. Review, then accept each route with
      `pnpm visual:accept <route-id>`. Not run.
      **Also covers (folded in 5 Oct), so one `pnpm visual` pass clears all of
      them:**
      - 16.4: the four content editors' Save banner, and the adverts nav row on
        every console route (23 Sep).
      - 17.7: the grid homepage's supplier logo row (24 Sep).
      - 18.2: `console_releases`, a new route with no baseline.

      Every route has also moved since the last acceptance (22 Sep), because
      grid became the default design (5 Oct), and so did §23's banner carousel.
      Never `--all`: accepting a baseline asserts you looked at it.
- [ ] **19.5 — Restart local Supabase so it picks up `config.toml`.** The
      running auth container still has `GOTRUE_SITE_URL=http://127.0.0.1:3000`
      and an allow-list of only `https://127.0.0.1:3000`; `config.toml` has had
      3100 for weeks. Every auth email link locally (**password reset** and the
      new **login-email change**) redirects to a dead port. Run
      `supabase stop && supabase start`. That keeps the data (it is not
      `db reset`), but it restarts a shared service other sessions use, so pick
      a quiet moment. Then check `docker exec supabase_auth_app printenv
      GOTRUE_SITE_URL` shows `:3100`.
- [ ] **19.6 — Hosted Supabase settings for the login-email change (GAPS
      A4.12).** In the hosted dashboard, never via `config push`:
      (a) add `https://<domain>/account/email/confirm` to the redirect
      allow-list; (b) confirm **Secure email change** is on; (c) optionally
      switch the "Change email address" template to a `{{ .TokenHash }}` link to
      `/account/email/confirm?token_hash=…`, so the link works on any device
      (the default PKCE link only works in the browser that asked). Then do one
      real change end to end: confirm whether one link or both are needed, and
      that the member lands back in Settings. Neither could be confirmed locally
      (19.5).

**Done:** 19.4 this pass's migrations (`20260928000001`–`000005`, plus `20260929000001` and `20261001000001`) pushed 1 Oct; none pending (68 total).

## 20 · Homepage advert positions (29 Sep) — production follow-through

**Done:** 20.1 `20260929000001_home_banner_slots.sql` pushed 4 Oct (with 22.1, one `supabase db push --db-url`) · 20.2 moot 4 Oct: banners are sold as one sitewide pool of spots, not per position, so per-position slots are gone (§23.1).

## 21 · Error logging, Phase 1 (1 Oct) — switches it on

See `docs/logging.md`. The code records errors as soon as it deploys; these
steps decide who hears about them.

- [ ] **21.2 — Set `DEVELOPER_EMAILS` in Vercel** to your own login email.
      Unset, `/console/errors` 404s for everyone, you included.
- [ ] **21.3 — Set `DEV_ALERT_EMAIL` in Vercel** to where error alerts and the
      daily digest should go. Unset, errors are recorded but nobody is emailed.
      Alerts also need the Resend key (§1, GAPS B3.3): until then they're inert
      in production. Locally they arrive in Mailpit. **5 Oct:** the key is set
      (1.4), so alerts send once this variable is set, but until the domain is
      verified (1.2) only to the Resend account owner's address.

**Done:** 21.1 `20261001000001_error_log.sql` on production (in 19.4's 1 Oct push).

## 22 · Junk news topics (4 Oct) — production follow-through

**Done:** 22.1 `20261004000001_prune_junk_categories.sql` pushed 4 Oct by Luiza (with 20.1): 8 junk WordPress tags deleted by slug, taking `categories` from 44 to 36 (`exhibitions` kept); the seeds skip the same slugs (`scripts/lib/news-topics.ts`).

## 23 · Banner spots and carousel (4 Oct) — production follow-through

- [ ] **23.1 — Push `20261004000002_banner_spots.sql` to production**
      (`pnpm db:push:prod`). It adds the `banner_spots` setting (`{"count": 8}`,
      kept as-is if the row already exists) and **drops `advert_slots`** — the
      per-position caps nothing ever read. The drop loses only those labels and
      caps, and can't be undone short of recreating the table. Until it runs,
      Console → Adverts → Inventory still works (the count falls back to 8 if
      the row is missing) but production carries the dead table. Afterwards,
      check Inventory shows "Spots we sell: 8" and the next-six-months table.
      *(Working tree, uncommitted.)*
- [ ] **23.2 — Tell Jas the impression figures will step up.** Each banner
      position now cycles 3 adverts in-page (§5.4), and each one counts its own
      impression once it has been on screen for a second. The 30-day stat on
      Console → Adverts and members' own dashboards rise from deploy day; the
      definition of an impression didn't change, only how many get shown.

---

## 24 · Fix-list 75–79 (6 Oct) — production follow-through

- [ ] **24.1 — Push `20261006000001_advert_booking_price.sql` to production.** Adds
      `advert_bookings.price_pennies` and copies any rate-card product's rate onto the
      bookings sold under it. Until it's applied, the new Bookings / Supplier Logos price
      fields and approval invoicing fail on production (the column doesn't exist), and
      the Command Centre revenue query errors. Additive and idempotent:
      `pnpm db:push:prod` (or `supabase db push --linked`, as 19.4). Ship it **with** the
      code, not after.
- [ ] **24.2 — Look at the new console screenshots before accepting them.** `pnpm visual`
      has new ids `console_adverts_banners`, `console_adverts_suppliers`,
      `console_stories_list`, `console_featured_member_id` and `console_supplier_logo_id`
      (no baselines, so they hard-fail until accepted), and every console baseline moves
      with the nav (Adverts & Banners, + Supplier Logos). `console_adverts_spots` and
      `console_adverts_spots_new` are orphaned. `console_takeover_id` is skipped until a
      takeover is booked locally.

## 25 · Online payment for advertising (6 Oct) — switches it on

Built and tested locally in "simulated" mode: a priced run, bundle, supplier logo,
Featured Member slot or takeover is **held** (not on the site) until the member pays
its invoice from `/dashboard/pay/invoice/…`, then released. Without the keys below,
production behaves exactly as before: nothing is held, invoices are issued and Jas
collects by hand. It has **never run against real Stripe** — 25.4 is the first time.

- [ ] **25.1 — Push `20261006000002_advert_payments.sql` to production**, with or
      after 24.1 (`pnpm db:push:prod`). Adds the invoice links, `paid_at`, the
      `awaiting_payment` booking status, and the placements price and hold flag.
      Additive. The code reads these columns, so ship it **with** the code.
- [ ] **25.2 — Set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** (the `pk_…` key) in Vercel,
      production and preview, beside §6.3's `STRIPE_SECRET_KEY`. Advert payments go
      live only with **both** set. It's a `NEXT_PUBLIC_` variable, so it is baked in
      at build time: redeploy after setting it.
- [ ] **25.3 — Add `checkout.session.async_payment_succeeded`** to the webhook
      endpoint's events (§6.2). `checkout.session.completed` already covers cards;
      this one settles delayed methods such as bank debits if they're ever enabled.
- [ ] **25.4 — Test one payment end to end in Stripe test mode** before going live:
      book a priced run for a test member, pay it with card `4242 4242 4242 4242`,
      and confirm three things: the run turns "scheduled", the invoice says "paid"
      on both the console and the member's billing page, and the webhook delivery
      shows 200 in the Stripe dashboard. Also try `4000 0025 0000 3155` (3-D
      Secure): it opens a frame from `hooks.stripe.com`, which the CSP allows.
- [ ] **25.5 — Decide (Jas):** an unpaid hold keeps its dates reserved until its
      term ends, and is then ended as "unpaid" with the invoice voided. Nothing
      chases it in between: no reminder email, and no earlier expiry. If either is
      wanted, it's a small follow-up in the `advert_lifecycle` sweep.

## 26 · Jas's industries (12 Oct) — production follow-through

Jas's ten industries replace ours, a member can be in several (with one
primary), and every member, story, video and event gets its industry from his
mapping of Services and news categories (`scripts/lib/industry-map.ts`).
Migration `20261012000001_industries_jas_member_industries.sql` swaps the list
and **clears every existing assignment**. The backfill then re-derives them all
from the `member_services` and `story_categories` already on the target. It
needs no WordPress export. Industry slugs change (`/industry/welding` →
`/industry/welding-joining` and so on), with no redirects because the site isn't
public yet. *(Working tree, uncommitted.)*

- [ ] **26.1 — Push the migration, then run the backfill straight away.**
      `pnpm db:push:prod`, then `pnpm industries:backfill:prod -- --dry-run`
      (compare against the full-export simulation: primaries Automation 23 ·
      Welding 22 · Machinery 18 · Bending 16 · Inspection 10 · Software 7 ·
      Grinding 6 · Subcontractor 6 · Processing 5 · Events 2 · none 8), then
      `pnpm industries:backfill:prod`.
      Until the backfill runs, **nothing has an industry**: the `/industry/*`
      pages are empty and the directory's industry filter matches no one.
      Ship the code **with** the migration. Code that reads `member_industries`
      before it exists, or the old code reading members' industry without the
      `members_industry_id_fkey` hint once it does, fails silently (PGRST201):
      member profiles 404 and the directory renders empty. Run
      `pnpm verify:prod` afterwards. Its "member directory query" and "primary
      industry ∈ set" lines prove both halves.
      The backfill refuses to run a second time without `--overwrite`, because
      after launch the links are curated data. Pending profile revisions lose
      their proposed industry; the rest of each revision survives.
- [ ] **26.2 — Send Jas the "no industry" report** (GO-LIVE 1.1):
      `pnpm industries:backfill:prod -- --dry-run --report` prints every member
      and story left without one, as tab-separated rows.
- [ ] **26.3 — Accept the moved visual baselines.** Two causes, both expected:
      `tests/visual/manifest.ts`'s `industry_slug` route is now
      `/industry/welding-joining`; and the industry strip changed on **every
      public route**: two balanced, centred rows from `lg` up (three on a
      tablet, still one scrolling row on phones) to fit Jas's longer names, and
      on grid it is now a very light grey band (`bg-shade`) instead of white. Run `pnpm visual`, look, then accept each route:
      `pnpm visual:accept <route-id>`.

## 27 · Jas's Story Engine feedback (13 Oct) — production follow-through

Fix-list 80–87. Four migrations, all additive and idempotent:
`20261015000001_story_member_drafts.sql` (`stories.member_draft`),
`20261015000002_story_social_posts.sql` (`stories.social_posts`) and
`20261015000003_story_members_tagging.sql` (backfills every story's primary
member into `story_members`, adds a story-views index on `analytics_events`,
and narrows `story_members`' public read to published stories), and
`20261015000004_story_summary.sql` (the `story_summary` computed field). All four were
applied locally with `supabase migration up`; no reset. *(Working tree, uncommitted.)*

- [ ] **27.1 — Push the four migrations with the code, not after it.**
      `pnpm db:push:prod`. The code reads `member_draft`, `social_posts`,
      `story_members` and `story_summary` straight away: without the columns, saving a story fails
      and member profiles lose their story lists. The `analytics_events` index
      is built on the partitioned parent, so it locks every partition while it
      builds. Run it outside traffic once there is real traffic.
- [ ] **27.2 — Jas pastes SMI's post links after Buffer posts.** Each story in the
      console has three new fields, "SMI's posts of this story" (LinkedIn,
      Facebook, X). Buffer never returns the live post's URL, so nothing fills
      them automatically. Any left empty link to SMI's page on that network, so
      the story page is never broken, just less specific. Worth telling him in
      the reply to his feedback.
- [ ] **27.3 — Look at the visual baselines for the story route and every
      rich-text surface.** Run `pnpm visual`, look, then accept each route:
      `pnpm visual:accept <route-id>`. Expected changes:
      - The story page is wider from `lg`, with a member sidebar.
      - The share buttons became an icon row.
      - The member box became tiles.
      - Every `.story-body` (profiles, events, videos, machines, static pages)
        gained a float-clearing `::after` for the new image alignment.

## Not in this list

Other approval-gated externals — MaxMind/GeoLite2, the
GitHub/Vercel/Supabase ownership transfers, and the London-region Supabase
project — are tracked in [`README.md`](../README.md) under "Outstanding" and in
`GAPS.md` Part B. Stripe, Bigin and Buffer moved into §6/§7/§15 above once their
adapters were built. Everything else that needs a person (accounts, production
pushes, dashboard settings, decisions, visual baselines) is above.
