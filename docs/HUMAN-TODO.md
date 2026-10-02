# Human to-do — things Claude can't do

Actions that need a person: external accounts, DNS, hosted-dashboard settings,
restarting shared services, and decisions that are someone's to make. Everything
here is **blocking real behaviour** — the code for each item is written and
merged, but inert until the step is done.

Created 31 Aug 2026 alongside the Resend email work (`GAPS.md` B3, B5, C3,
A4.1). Add to it rather than starting a second list.

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
- [ ] **1.5 — Decide the reply-to address.** Without `EMAIL_REPLY_TO`, replies go
      to `noreply@` and reach nobody — including a member answering "your advert
      needs a change before it runs", which is a message that invites a reply.
- [ ] **1.7 — Know that "Send a test" in the console is inert until 1.1–1.4 are
      done.** `/console/email-templates` has a "send yourself a copy" button on
      every template (fix-list 63). Locally it lands in Mailpit; in production,
      with no `RESEND_API_KEY` set, it logs to the server console and reports
      nothing arriving. The page says so, but the first person to press it will
      reasonably file it as a bug otherwise. Nothing to do here except the steps
      above — this is a note, not a task.
- [ ] **1.6 — Smoke-test before pointing it at real people.** Send to Resend's
      test addresses, which exercise the real API and webhooks:
      `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`
      (labels work: `delivered+reset@resend.dev`). **They count against quota.**
      Do not use `@example.com` or `@test.com` — those bounce.

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
      narrower on a phone. Reasonable, but it is his rate card.
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

- [ ] **5.1 — Two pre-existing e2e specs are broken**, unrelated to email, found
      while verifying. Both are small fixes — say the word and they get done:
      - `tests/e2e/join.spec.ts` calls `createAccount` **4 times** against
        `allowRequest("join", 3, HOUR)`, so it can never fully pass. Either the
        spec drops a signup or the limiter changes — and the limiter is a
        security control, so that is a real choice.
      - `tests/e2e/console-members.spec.ts:29` waits for `/console/member/`
        (singular) while the route is `/console/members/`. Stale since the
        route-rename commit; it fails all 7 tests in that file. One character.
- [ ] **5.2 — `CRON_SECRET` is not set locally.** `/api/cron` fails closed with
      503 and `scripts/job-runner.ts` refuses to start, so no background job —
      and therefore no email — runs locally without it. Add it to `.env.local` if
      you want the local queue working.
- [x] **5.3 — No console inbox page exists** (`GAPS.md` A1.9). ~~Until `ADMIN_EMAIL`
      is set, contact enquiries live *only* in `inbox_messages`, and the console
      shows just the 5 most recent **unread**. A sixth enquiry is currently
      unreachable in the UI.~~ Done — `/console/messages` now exists (`GAPS.md` A1.9).
- [ ] **5.4 — Confirm advert slot rotation matches the spec (`GAPS.md` A2.10).**
      Each slot deals up to 3 live adverts; a page now shows one of them picked
      uniformly at random (`pickOne()`, `src/lib/adverts.ts`) and that pick stays
      fixed for the rest of the page load — reload and you may see a different
      one of the 3. This is the interim fix you asked for. `requirements/USE-CASES.md`'s
      S1 says a slot "cycles its ~3 adverts," which this satisfies on one
      plausible reading (rotation across page loads) but not another (an in-page
      carousel cycling through all 3 within one view). The requirements docs
      weren't edited to match current behaviour — that's not ours to decide.
      If you want an actual in-page carousel, note that `HomeHero.tsx` has an explicit "no
      client-side timers, ever" rule (scoped to the hero, but the same instinct
      would apply here) — worth deciding deliberately rather than by default.
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

## 7 · Bigin/Zoho CRM — blocks the contacts write-through

The code is written and merged (`GAPS.md` B6.1–B6.2) but inert until this is
done. Without it, contacts still only live in the app's own `contacts` table
— nothing is lost, but Bigin never hears about a new member or newsletter
signup.

- [ ] **7.1 — Create the Bigin account, SMI-owned**, and register an OAuth
      client (client id + secret) in the Zoho API console.
- [ ] **7.2 — Generate a refresh token** via Zoho's OAuth consent flow (a
      one-time authorization-code exchange) and set `BIGIN_REFRESH_TOKEN`.
      Zoho access tokens expire hourly; the refresh token is what makes this
      unattended.
- [ ] **7.3 — Confirm the account's data centre** and set `BIGIN_ACCOUNTS_BASE`
      / `BIGIN_API_BASE` accordingly if it isn't the EU one
      (`accounts.zoho.eu` / `www.zohoapis.eu`, the defaults) — Zoho pins an
      account to a data centre at creation and the wrong host rejects every
      call.
- [ ] **7.4 — Set the production env vars in Vercel**:

      ```
      BIGIN_CLIENT_ID=
      BIGIN_CLIENT_SECRET=
      BIGIN_REFRESH_TOKEN=     # from 7.2
      BIGIN_ACCOUNTS_BASE=     # only if not the EU default
      BIGIN_API_BASE=          # only if not the EU default
      ```
- [ ] **7.5 — Watch the first real push closely.** `BiginCrmSync` is written
      against Bigin's *documented* Contacts API but has never run against a
      live account — confirm the request/response shape on the first real
      `pushContact` call (console CRM edit page, or a newsletter signup).

---

## 8 · Security hardening (1 Sep) — production follow-through

The pre-delivery security pass closed several holes locally; two of the fixes
are inert in production until these steps run.

- [x] **8.1 — Apply migration `20260901000014_lock_down_anon_writes.sql` to
      production** — done 1 Sep 2026 via `pnpm db:push:prod`, which applied all
      16 pending migrations (20260831000006 → 20260901000014); remote is now in
      sync with local.
- [ ] **8.2 — Create the private `invoices` bucket in the hosted Supabase
      dashboard** (Storage → New bucket → name `invoices`, public **off**).
      New invoice PDFs upload there; without the bucket, PDF generation fails
      soft (invoice rows still record, `pdf_path` stays null).
- [ ] **8.3 — Check the production `media` bucket for existing
      `invoices/…` objects** and move them into the new private bucket (the
      billing page handles both path shapes). Likely zero — the invoice-PDF
      feature is newer than the last deploy — but confirm rather than assume.
- [ ] **8.4 — CSP nonce migration stays deferred** (documented in
      `next.config.ts`): `script-src 'unsafe-inline'` is accepted for now.
      When the nonce work happens, the JSON-LD `<script>` tags added for SEO
      must carry the nonce too.

---

## 9 · Member-area rework (3 Sep) — production follow-through

- [x] **9.1 — Apply migration `20260902000003_drop_member_testimonials.sql` to
      production** — done 6 Sep 2026 via `pnpm db:push:prod` (applied
      20260902000003 → 20260904000001; remote in sync with local). Production
      still serves the holding page from `main`, so no deployed code read the
      dropped column. Original note kept for the record:
      deploy the app code first or in the same release: the code no longer
      reads or writes `members.testimonials`, and `decideRevision` strips the
      key from old pending revisions, so code-before-migration is the safe
      ordering. The migration also scrubs the key from stored
      `member_revisions.payload` rows before dropping the column.

---

## 10 · Fix-list pass (3 Sep) — production follow-through

- [x] **10.1 — Apply migrations `20260903000001_content_page_collapsible.sql`,
      `20260903000002_event_coords.sql` and `20260904000001_membership_types.sql`
      to production** — done 6 Sep 2026 with 9.1 (one `pnpm db:push:prod`).
      Note: the CLI (v2.109) prints a noisy `pgdelta-target-ca.crt: ENOENT`
      error after "Finished supabase db push" — that's its post-push drift
      check failing locally, not the migrations; confirm with
      `supabase migration list --linked`.
- [ ] **10.2 — Seed the FAQ page on production** (`pnpm seed:real -- --pages-only`
      now includes it, same About-page mechanism) **and review its copy** — the
      seven starter Q&As are my drafting, written to be plausible, not
      authoritative; edit at `/console/content-pages/faq`.
      **Amended 21 Sep (fix-list 69):** that same `--pages-only` run now also
      carries **eleven more FAQ answers**, the **three terms pages**
      (`terms`, `membership-terms`, `advertising-terms`) and a **corrected
      Policies page** whose two links to `bestfoundation.org.uk` — an
      unrelated charity, live on production today — are fixed. The link fix
      alone is reason to run it.
      **Read the terms before you push them.** They carry six
      `[SMI TO CONFIRM]` markers (VAT, registered company details, refunds,
      artwork deadline, advertising cancellation, governing law) which will
      render **verbatim on the live page** — that is deliberate, so they can't
      ship unnoticed, but it means these three pages are not fit to publish
      until Jas has answered `docs/ask-jas.md` §9. The FAQ and the Policies
      link fix have no such markers and are safe to push on their own.
- [ ] **10.3 — Tick "Collapsible sections" on the production Policies page**
      (`/console/content-pages/policies`) — the checkbox is new; prod rows
      default to off, so the page renders exactly as before until ticked.
- [ ] **10.4 — Upload real example images for the six advert formats** at
      `/console/adverts/spots` (new per-format upload). Cards on `/advertising`
      show no image until one is uploaded.
- [ x ] **10.5 — Event map pins appear as events are re-saved.** Existing events
      have no coordinates and bulk geocoding is against Nominatim's policy, so
      the public map stays hidden until at least one upcoming event is saved
      (console or member form) with a location. Re-save the current upcoming
      events once to populate it.
- [ x ] **10.6 — "For you" on `/news` personalises only for visitors who accepted
      the full cookie banner** (same consent gate as analytics); everyone else
      sees the popular-this-month fallback. Flagging so the behaviour isn't
      mistaken for a bug.
- [ x ] **10.7 — Remove the advert block from production's member-profile page
      layout** (fix-list item 27). The default layout for new members no longer
      carries one, and the local DB's `page_layouts` row (`page_type =
      'member_profile', entity_id is null`) was edited directly to match — that's
      row data, not a migration, so `db:push:prod` won't carry it. On prod, either
      edit the same row directly or re-save the layout from
      `/console/pages?type=member_profile` with the advert block removed.
      Note: the new `profile_video` block is a required anchor (fix-list item
      28), so a prod row that predates it fails validation and `getLayout`
      already falls back to the code default (no advert, video included) —
      the public page is effectively right on deploy; re-saving from the
      console just replaces the stale row with a valid one.
- [ ] **10.8 — Re-seed real story categories on production** (fix-list item 31).
      The live site's actual ~30-category taxonomy turned out to live in WP's
      `/tags`, not `/categories` (which is almost entirely "Uncategorized") —
      `scripts/seed.ts` was fetching the wrong one. Prod's `categories` table has
      the same gap this local DB had; there's no migration for it since it's
      content, not schema. Either run the corrected fetch against prod (same
      `fetch("https://sheetmetalindustries.com/wp-json/wp/v2/tags?per_page=50&orderby=count&order=desc")`
      → upsert into `categories`, top 30 by count) or add them by hand at
      `/console/categories`.
      **Amended 10 Sep 2026:** the upsert no longer takes a `kind` — migration
      `20260909000002` dropped that column, so `categories` is news topics only
      and the rows are just `{ slug, name }`.

---

## 11 · Visual regression suite (9 Sep) — decisions for you

The suite is built and working (`tests/visual/`, `pnpm visual`). 79 baselines are
committed. These three need a person.

- [ ] **11.1 — Review the first baselines.** Accepting a baseline asserts someone
      looked at the picture. I reviewed all 79 as contact sheets and spot-checked
      individual pages (the homepage, a member page, the console), and found and
      fixed two bad captures that way — but I am not the right last word on
      whether each page *looks correct*. Worth one pass through
      `pnpm visual:report` before trusting the set.
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

---

## 12 · Industries refactor (10 Sep) — production follow-through

> **DONE on production, 22 Sep.** 12.1 and 12.2 both ran (backup taken first).
> `db push --linked` applied **four** migrations, not just the industries one —
> `20260917000001`, `20260917000002` and `20260918000001` went with it, so
> `prospect_marks` and `email_templates` now exist on prod too. Final state matches
> the predictions below exactly: industries 10, categories 44, services 69,
> members 123 with **114** carrying an `industry_id`, member_services **483**,
> member_membership_types **90**, 10 content rows inheriting a member industry.
> Verified by re-running the console's own query against prod — the
> `industry:industries(name)` embed that had been failing returns 206 with count
> 123, and `/console/members/[id]`'s `industry_id` select returns 200.
>
> Two things learned in the process, worth knowing before anyone reruns this:
>
> - **The `--dry-run` under-reports, and the numbers below are the live ones.** The
>   dry run skips step 2's `services` upsert, so it builds its slug map from the 68
>   rows the migration created and predicts `services (68)` / **455**
>   member_services. The live pass upserts all 69 extract terms first and produces
>   **483**. A dry run showing 455 is correct behaviour, not a shortfall.
> - **`automation-robotics` now exists in BOTH `industries` and `services`**, under
>   slightly different names ("Automation & Robotics" vs "Automation / Robotics").
>   The migration excludes it from `services` on purpose (step 4 filters
>   `slug not in (select slug from industries)`); the backfill's step 2 upserts the
>   extract's 69 member-kind terms with no such filter and puts it back. Harmless to
>   the console, but it means the /find-a-member Services vocabulary carries a term
>   that is also an industry facet — see ask-jas §11.

Industries became their own table and content gained a direct `industry_id`
(migration `20260909000002`). The migration carries the schema **and the 10
industry rows**, so `db:push:prod` alone fixes the wrong industry list that
production has been serving. What it cannot carry is the per-member assignment
and the two link tables — those are derived from the WordPress export, which
SQL can't reach.

Do these in order.

- [x] **12.1 — Apply migration `20260909000002_industries.sql` to production**
      (`pnpm db:push:prod`). **Take a dashboard backup first.** I have not
      verified that the Supabase CLI wraps a migration file in a transaction, so
      treat a mid-file failure as possibly leaving a partial state. The file is
      written to be correct on production's broken data specifically: step 4
      copies the 69 WordPress Services terms out of `categories` into `services`
      **before** step 8 deletes them. Those 69 rows exist only there and in the
      extract — if the order is ever disturbed, they are gone.
      Expect after: `industries` 10, `categories` 44, `services` 69.
- [x] **12.2 — Read the dry run, then run the taxonomy backfill.** The migration
      leaves every member's `industry_id` null on prod (their old category was a
      service term, which matches no industry slug). This fills it, plus the two
      empty link tables:

      ```
      pnpm taxonomies:prod -- --dry-run    # prints every change, writes nothing
      pnpm taxonomies:prod                 # the live pass
      ```

      It is idempotent — every write is an upsert on a natural key — so a failed
      run can simply be repeated. Members are matched to the extract **by slug**,
      and both directions of mismatch are printed rather than skipped quietly;
      expect exactly one unmatched target row (`media-co`) and none unmatched in
      the extract.

      Expect after: 114 of 123 members with an `industry_id` (9 legitimately
      resolve to none), `member_services` 483, `member_membership_types` 90.
      Verify with `supabase inspect db table-stats --linked`.
- [ ] **12.3 — The industry assignment is still a dev assumption.** It is derived
      from each member's Services tags by `scripts/lib/industry-map.ts`, not
      stated by any source. This is `GO-LIVE.md` item 1.1 and it does not close
      just because production now has the data — Jas still has to confirm the
      10-item list and the per-member assignments.
- [ ] **12.4 — Content industries stay almost entirely empty on prod, by
      choice.** Existing stories/videos/events inherited from their member only
      (decided 9 Sep, no inference from news topics), which on production is 16
      video rows and nothing else — prod's 300 stories and 53 events have no
      member at all. `/industry/[slug]` will therefore show no news there until
      content is tagged. Tag it at `/console/stories/…` as stories are edited, or
      revisit the decision — deriving from news topics would have resolved 88 of
      the 300.

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
- [ ] **14.2 — Accept the `home@grid` visual baseline.** The restyle changes
      that page completely, so `pnpm visual` will report it as changed (exit 1)
      until someone looks at the picture and runs `pnpm visual:accept home@grid`.
      I have not run it — accepting a baseline asserts you looked, per §11.1.
      Note the grid design's header and footer now apply to **every** grid-mode
      route, not just `/` (there is one public layout). No other route has a
      grid baseline, so nothing else in the suite moves, but grid-mode `/news`,
      `/member` and the rest do look different now. That was the agreed
      trade-off, not an oversight.
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
      (fix-list 61). A live `featured_member` placement renders again. Note it
      is a static list, not the carousel that `src/lib/visibility-products.ts`
      and the rate card both promise — see §14.6.
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
      (`src/lib/pricing.ts`). None of it was ripped out, because a Postgres
      enum value cannot be dropped cleanly and the format may yet find a home.
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
- [x] **14.6 — "Featured Member" is sold as a carousel. It is one now.**
      **Closed 20 Sep on the grid design** (fix-list 68): the component
      changed rather than the copy. The homepage box is a real vertical
      carousel — three placements on screen, advancing one at a time, pausing
      on hover and on keyboard focus, with dots that are also the manual
      control. So `src/lib/visibility-products.ts` ("Homepage carousel +
      higher directory ranking"), `DEFAULT_AD_FORMATS` key B and the console's
      Featured Member page are now telling the truth at the point of sale.
      **The cap went 4 → 8 at the same time** (`FEATURED_SLOTS` in
      `src/lib/pricing.ts`), since a rotation showing three at a time has room
      for more advertisers than a static list of three did. That doubles the
      sellable inventory on this placement at £400/slot — **a commercial
      decision, so tell me if 8 is wrong** and it is a one-constant change
      back. It is enforced in the booking action only, no DB constraint, and
      it drives the console dashboard's slot pips and the Featured Member
      page's copy automatically.
      Two things still open. **Forge is unchanged** — it shows a band under
      the hero, so the promise is still only kept on grid, which is not yet
      the live design. **The higher-directory-ranking half of that product is
      a separate claim** and I have not checked whether it is honoured.

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

Two migrations landed locally in this pass and neither is on production yet.
Production was only brought up to date on 22 Sep (§12.1), so it is currently one
push behind again rather than five.

- [ ] **16.1 — Push the two new migrations to production.** `pnpm db:push:prod`.
      They are `20260923000001_inbox_categories.sql` (the message/notification
      split, the `inbox_replies` table, `inbox_messages.replied_at`) and
      `20260923000002_member_archive.sql` (`members.archived_at` and a replacement
      RLS policy). Both are additive and idempotent — no column is dropped and no
      row is deleted. **Take a backup first**, as on 22 Sep.
      **Update (27 Sep), unverified:** probably overtaken by §17 — the new
      project holds `story_members` (`20260924000001`, the newest migration), and
      `db push` applies in order, so these two are very likely there. Nobody has
      run the migration list against the new project to confirm. With the new
      account's token (17.4):
      `SUPABASE_ACCESS_TOKEN=… supabase migration list --project-ref bvyxeujhecxulzwvpxfr`
      — then tick this and run the 16.2 / 16.3 checks.
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
- [ ] **16.4 — Accept or reject the moved visual baselines.** This pass moved
      several: the four content editors gained a Save banner and a pending button,
      and the adverts nav row changed on **every** console route. `pnpm visual` was
      deliberately not run and no baseline was touched — accepting one is
      asserting you looked at the picture. Per route:
      `pnpm visual:accept <route-id>`.

---

## 17 · WordPress migration to the new project (24 Sep) — production follow-through

The full export was imported into the new Supabase project
(`bvyxeujhecxulzwvpxfr`): 123 members, 1,992 stories, 387 videos, 53 events,
2,643 media objects. Verify any of it with `pnpm verify:prod`, which compares the
live database against `handover-extract/seed/` and names every difference.

- [x] **17.1 — Delete the five seed fixture logins from production. Do this
      first.** `scripts/seed-real.ts` created `jas@`, `media@` and
      `member1-3@smi.local`, all with the password `local-dev-password`
      **hardcoded in the repo** — and `jas@smi.local` carries `role=admin`.
      Anyone who can read this repository can sign into the console as an
      administrator. `seedDemoRows` already refused `--remote`; `mkUser` was
      missed. **The code hole is fixed** (the whole fixture block is now gated on
      `!REMOTE`), so this cannot recur — but the accounts it already created are
      still live and only a person can remove them. Delete them in
      Authentication → Users, and the `media-co` draft member row with them.
      `pnpm verify:prod` fails while any `@smi.local` account remains.
      **Update (25 Sep):** the project now holds **27 accounts**, up from the 5
      fixtures — so real people are on this database alongside an admin login
      whose password is published in this repository. This stopped being
      housekeeping when the first real account was created.
      — **done 27 Sep.** All 27 test/fixture logins removed in the dashboard;
      production auth now holds exactly two accounts, both deliberate
      (`admin@smi.test`, `member@smi.test` — see 17.12). None of the 27 was a
      real user. Deleting `media@smi.local` cascaded its profile away but left
      the `media-co` member row behind as a harmless `draft` orphan, still
      counted by `pnpm verify:prod` as one of two expected extras.
      **Still open (27 Sep), re-checked twice:** all five are on
      `bvyxeujhecxulzwvpxfr`, each created 2026-09-25 03:58 UTC by the original
      seed — so never deleted, not deleted-and-recreated. Most likely the
      deletion happened in the old project (`kgjnwyojgajcvsberods`); check the
      project ref in the dashboard URL. **`jas@smi.local` has signed in —
      2026-09-26 04:22 UTC**, while `.env.local` still pointed at production
      (17.9), so probably a local test or dev login using the repo password.
      Unconfirmed: the Supabase auth logs for that timestamp would show the
      origin. `verify:prod` now prints each fixture's created / last-sign-in time.
- [ ] **17.2 — Storage buckets exist only in the seed script, not in a
      migration.** `media` (public) and `invoices` (private) are created by
      `seed-real.ts` at lines 672-674. A schema-only deploy — `db:push:prod` with
      no seed — leaves a project with no buckets and every image 404ing. There
      are also no storage RLS policies anywhere in the repo. Worth deciding
      whether bucket setup should become a migration rather than staying
      tribal knowledge in a seed script.
- [x] **17.3 — Supabase must be on a paid plan before the media import.** The
      referenced media alone is 1019.4 MiB against a 1 GiB free-tier cap — no
      headroom at all. Measured total with inline story images re-hosted: 1.19
      GiB. — done 24 Sep, project created on a paid plan.
- [ ] **17.4 — The CLI is authenticated as the old account.** `supabase link`
      against the new project fails with a privileges error because the stored
      login belongs to the previous account, which can only see `momai-website`
      and the old `smi-app` (`kgjnwyojgajcvsberods`). Browser access to that
      account is lost, so **do not run `supabase logout`** — the stored token may
      be the only remaining way in, and it should be backed up out of the macOS
      Keychain. Use `SUPABASE_ACCESS_TOKEN=…` per command for the new account
      instead; it takes precedence over the stored login.
- [x] **17.5 — Apply the legacy event types to the imported events.** The
      `event-type` terms were never mapped, so all 53 events had a null `type`.
      — done 25 Sep via the new `--events-only` repair mode: 32 types written
      (13 exhibition, 19 open_house), 21 legitimately have no legacy term.
      Re-running reports `0 type, 0 coordinates (53 already correct)`.
- [ ] **17.6 — Redeploy Vercel from `97975e6` or later.** That commit carries
      the PGRST201 fix — `story_members` had made every `member:members(...)`
      embed on a stories query ambiguous, which rendered the news page empty
      with no error anywhere, because `queries.ts` discards `error` on every
      read. Until the deployment is rebuilt from it, the live site is still
      serving the broken embed. The same commit adds request logging, so any
      remaining fault will name itself in the Vercel runtime logs rather than
      showing as blank content.
- [ ] **17.7 — Accept the homepage visual baseline.** The supplier logo row
      below Featured member news changes the grid homepage, so the committed
      baseline no longer matches. `pnpm visual:accept <route-id>` — never
      `--all`, and never by an agent: accepting a baseline is asserting you
      looked at the picture.
- [x] **17.9 — Remove the test rows the integration suites wrote to
      production.** `vitest.config.ts` loads `.env.local` into the test
      environment, and eight suites under `tests/unit/` insert real rows gated
      only on `SUPABASE_SECRET_KEY` existing — never on the target being local.
      With production credentials in that file, routine `pnpm check` runs on
      25 Sep put **77 rows** into the live database: 53 `members`, 12
      `contacts`, 11 `inbox_messages`, 1 `newsletter_issue` — plus ~22 auth
      accounts. Nothing imported was damaged: those suites only ever insert, and
      `pnpm verify:prod` confirms stories, videos, events, media and every
      recovered field still match the extract exactly.
      **The hole is now closed** — `tests/setup.ts` refuses to run against a
      non-local Supabase URL (`ALLOW_REMOTE_INTEGRATION_TESTS=1` to override
      deliberately), and `.env.local` has been repointed at the local stack.
      What remains is the clean-up: `pnpm audit:test-rows:prod` lists them,
      `-- --delete` removes them. The auth accounts have no cascade from
      `members` and must go in the dashboard, alongside 17.1.
      — **done 27 Sep.** All 77 rows deleted and the auth accounts cleared with
      17.1. `pnpm verify:prod` confirms the import survived untouched — stories,
      videos, events, story_members, brand colours, coordinates, event types and
      adverts all still match the extract — and the public directory is back to
      **74 active members** from the 105 the fabricated rows had inflated it to.
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
- [x] **17.10 — Delete the SAMPLE adverts from production.** The 24 Sep import
      ran a full `seed:prod`, and a full run seeded `seedAdverts()`'s placeholder
      inventory on `--remote` too: 8 banners and 5 supplier logos stamped
      "SAMPLE — NOT A LIVE BOOKING", each **branded with a real member company
      that has bought nothing**, booked `live`. On the public site that is not a
      placeholder, it is a false statement that those companies advertise here.
      Confirmed present on production by Luiza on 27 Sep, with no real adverts
      beside them. **The code hole is fixed** — `seedAdverts()` now throws on
      `--remote`, and a full remote run imports the real inventory (17.11)
      instead — and `pnpm verify:prod` now fails while any `panels/` advert
      exists on a non-local target. Removing the existing ones needs a person
      (a production delete): in `/console/adverts/artwork`, or by SQL —
      `delete from adverts where desktop_path like 'panels/%';` (bookings
      cascade). The same run also created the sample **rate card**
      (`advert_products`, eight rows at invented prices, e.g. £650 a banner) —
      check it against the real media pack before anyone sells from it.
      — done 27 Sep 2026 on Luiza's go-ahead, via the new
      `pnpm remove-sample-adverts:prod -- --delete` (dry run by default): **15**
      SAMPLE adverts (the 13 above plus 2 retired `banner_narrow`), their 15
      bookings, **82 `analytics_events`** recorded against them (no FK — left
      behind they would have kept counting as advert impressions on those
      members' stats pages), and all **8 rate-card rows**, none referenced by a
      real booking. The rate card is now empty: Jas must enter real products in
      `/console/adverts/spots` before any booking can carry a price.
      `verify:prod` shows `SAMPLE adverts 0 / 0`.
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

      Before Jas approves, three things worth her knowing: **approval emails the
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

## 18 · Admin release notes (28 Sep) — for you

`/console/releases` ("What's new", in the admin account menu) renders
`src/content/release-notes.md`. Members never see the link and are bounced
from the page.

- [ ] **18.1 — Review the first four entries' wording before it ships.** They
      were drafted from the 20–25 Sep commits in plain language for Jas; check
      nothing reads as a promise you don't want to make.
- [ ] **18.2 — Accept the new visual baseline** once you've looked at it:
      `pnpm visual:accept console_releases`. Until then `pnpm visual` exits 2
      on the missing baseline, by design.
- [ ] **18.3 — Add an entry with each deploy.** Nothing generates it. The
      format is in the comment at the top of the file, and a malformed edit
      fails `pnpm check` (`tests/unit/release-notes.test.ts`).

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
      edits back into `scripts/lib/static-page-content.ts`. Second, 10.2's
      caution about `[SMI TO CONFIRM]` in the terms pages still applies. The FAQ
      itself carries none, and a test keeps it that way.
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
- [x] **19.4 — Push this pass's migrations to production in the same release
      as the code** (`pnpm db:push:prod`, as in 9.1), then check with
      `supabase migration list --linked`:
      **Done 1 Oct 2026** with `supabase db push --linked` (env from
      `.env.production.local`): 20260928000001–000005, 20260929000001 and
      20261001000001 applied; `migration list` shows none pending (68 total).
      The `pgdelta-target-ca.crt: ENOENT` noise after the push is the CLI's
      drift check, as in 9.1, not a migration failure.
      - `20260928000001_search_members.sql` adds the function `/search` now
        calls for members. Deployed without it, member results on `/search` are
        silently empty (the page still loads). Function only.
      - `20260928000002_featured_machine_video.sql` adds a nullable
        `featured_machines.video_url`. Additive: no data changes. ⚠ **This one
        must not lag the code.** `activePlacements()` selects the new column and
        discards errors, so without it the query returns nothing and **every
        paid placement silently disappears**: Featured Members and the Featured
        Machine, on the homepage and the Featured Machine page. There is no
        error to notice, just empty slots someone has paid for. Machine saves
        would also fail.
      - `20260928000003_video_view_event.sql` widens the analytics
        event-kind check to allow `video_view`. Without it, video views
        just don't count toward Content reach (the rejected insert is logged
        and dropped, isolated from the page's own `page_view`); nothing breaks. The check constraint is dropped and
        re-added on a partitioned table, which re-validates every existing
        row: quick at today's volume.
      - `20260928000004_member_event_months.sql` adds the function the member
        stats page now counts impressions and clicks with. Without it, the
        Advert impressions and Clicks overview charts read empty (the page
        still loads). Function only, service-role only.
      - `20260928000005_inbox_page_edit_kind.sql` re-creates the inbox kind
        check with `page_edit_submitted` added. Without it nothing breaks: the
        edit saves, and its console notification is silently dropped
        (`notifyConsole` never throws), which is exactly the pre-fix behaviour.

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

## 20 · Homepage advert positions (29 Sep) — production follow-through

- [ ] **20.1 — Push `20260929000001_home_banner_slots.sql` to production.**
      `home_1`, `home_2` and `home_3` (the three homepage banners) were only
      ever inserted by the seed scripts, so a database built from migrations
      has no homepage rows on Console → Adverts → Inventory, and Jas can't set
      their caps. The migration adds them with `on conflict do nothing`, so it
      is safe on any database. Run `pnpm db:push:prod`, then check that the
      three "Homepage — … banner" rows appear on the Inventory page.
- [ ] **20.2 — Decide about the other slots that exist only in the seeds.**
      Like 17.2, `siderail_a`, `siderail_b`, `news_mid`, `footer`,
      `supplier_logos`, `home_sky`, `home_mpu_1`, `home_mpu_2` and
      `home_infeed` are created only by `scripts/seed.ts` and
      `scripts/seed-real.ts`. Checked 29 Sep: **`news_mid` and `footer`
      render on `/news`**, so production has the same gap there as it had for
      the homepage. `supplier_logos` is used by page blocks, and `siderail_b`
      only by the unused forge homepage. `siderail_a`, `home_sky`,
      `home_mpu_1/2` and `home_infeed` render nowhere (see 14.3). Add the ones
      that render to a migration, as 20.1 did, and decide whether the rest
      should leave the seeds. Not done in 20.1, which is scoped to the homepage.

## 21 · Error logging, Phase 1 (1 Oct) — switches it on

See `docs/logging.md`. The code records errors as soon as it deploys; these
steps decide who hears about them.

- [x] **21.1 — Push migration `20261001000001_error_log.sql` to production**
      (`pnpm db:push:prod`; the sandbox can't reach production). Additive: two
      new tables and one function. Until it's applied, nothing breaks — every
      error is still printed to Vercel's function log, and the database write
      simply fails quietly (`[error-log] could not record …`).
- [ ] **21.2 — Set `DEVELOPER_EMAILS` in Vercel** to your own login email.
      Unset, `/console/errors` 404s for everyone, you included.
- [ ] **21.3 — Set `DEV_ALERT_EMAIL` in Vercel** to where error alerts and the
      daily digest should go. Unset, errors are recorded but nobody is emailed.
      Alerts also need the Resend key (§1, GAPS B3.3): until then they're inert
      in production. Locally they arrive in Mailpit.

---

## Not in this list

Other approval-gated externals — MaxMind/GeoLite2, the
GitHub/Vercel/Supabase ownership transfers, and the London-region Supabase
project — are tracked in [`README.md`](../README.md) under "Outstanding" and in
`GAPS.md` Part B. Stripe, Bigin and Buffer moved into §6/§7/§15 above once their
adapters were built. This file covers what the Resend email work left open,
plus §6/§7/§15.
