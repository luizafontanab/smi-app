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

- [ ] **9.1 — Apply migration `20260902000003_drop_member_testimonials.sql` to
      production** (`pnpm db:push:prod`, together with whatever else is pending).
      Deploy the app code first or in the same release: the code no longer
      reads or writes `members.testimonials`, and `decideRevision` strips the
      key from old pending revisions, so code-before-migration is the safe
      ordering. The migration also scrubs the key from stored
      `member_revisions.payload` rows before dropping the column.

---

## 10 · Fix-list pass (3 Sep) — production follow-through

- [ ] **10.1 — Apply migrations `20260903000001_content_page_collapsible.sql`
      and `20260903000002_event_coords.sql` to production**
      (`pnpm db:push:prod`, together with whatever else is pending). Both are
      additive nullable/defaulted columns — safe in either deploy order.
- [ ] **10.2 — Seed the FAQ page on production** (`pnpm seed:real -- --pages-only`
      now includes it, same About-page mechanism) **and review its copy** — the
      seven starter Q&As are my drafting, written to be plausible, not
      authoritative; edit at `/console/content-pages/faq`.
- [ ] **10.3 — Tick "Collapsible sections" on the production Policies page**
      (`/console/content-pages/policies`) — the checkbox is new; prod rows
      default to off, so the page renders exactly as before until ticked.
- [ ] **10.4 — Upload real example images for the six advert formats** at
      `/console/adverts/spots` (new per-format upload). Cards on `/advertising`
      show no image until one is uploaded.
- [ ] **10.5 — Event map pins appear as events are re-saved.** Existing events
      have no coordinates and bulk geocoding is against Nominatim's policy, so
      the public map stays hidden until at least one upcoming event is saved
      (console or member form) with a location. Re-save the current upcoming
      events once to populate it.
- [ ] **10.6 — "For you" on `/news` personalises only for visitors who accepted
      the full cookie banner** (same consent gate as analytics); everyone else
      sees the popular-this-month fallback. Flagging so the behaviour isn't
      mistaken for a bug.

---

## Not in this list

Other approval-gated externals — MaxMind/GeoLite2, Buffer, the
GitHub/Vercel/Supabase ownership transfers, and the London-region Supabase
project — are tracked in [`README.md`](../README.md) under "Outstanding" and in
`GAPS.md` Part B. Stripe and Bigin moved into §6/§7 above once their adapters
were built. This file covers what the Resend email work left open, plus §6/§7.
