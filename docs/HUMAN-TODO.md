# Human to-do — things Claude can't do

Steps that need a person: external accounts, keys, hosted-dashboard settings,
production data, and decisions. The code for each is written and merged.

**How this list works.** Ordered by when things happen: set up the services,
push to production, check each service the first time it runs for real, then
the decisions. §7 holds what doesn't touch the deploy at all: staging setup
and housekeeping. Finished items are deleted and listed on their section's
**Done:** line, and git keeps the history.
Renumbered on 20 Oct 2026. Older references (GAPS, code comments, migrations,
commits) use the previous numbers, which are in `git show d89aee9:docs/HUMAN-TODO.md`.

**Open items now live in GitHub Issues (since 3 Nov 2026).** An entry below that says *Moved to #N* is tracked and closed in that issue; it keeps its number here because GAPS, code comments and other docs cite it.

Creating accounts, deploying, sending real email and calling paid APIs need
approval (`../requirements/BUILD-PLAN.md`).

---

## 1 · Set up the services

Each service is independent; do them in any order.

### Email — Resend

- [ ] **1.4a — Set `NEWSLETTER_FROM`** to `Sheet Metal Industries <…@sheetmetalindustries.com>`
      (an address on the verified domain). The SOP wants that sender name;
      unset, the newsletter comes from `EMAIL_FROM` like every other email.
- [ ] **1.5 — Create the subscriber segment** and set `RESEND_SEGMENT_ID`.
      Without it, newsletters stay unsent.
- [ ] **1.6 — Register the webhook** `https://<domain>/api/webhooks/resend`
      (contact updates, bounces, complaints) and set `RESEND_WEBHOOK_SECRET`.
      Without it, unsubscribes made at Resend never reach `contacts`.

### Hosted Supabase auth (dashboard only, never `supabase config push`)

- [ ] **1.7 — Auth settings in the hosted dashboard.** `config push` would
      overwrite them with the local values.
      - SMTP via Resend: `smtp.resend.com:465`, user `resend`, password the API
        key. The sending domain is verified, so this can go ahead.
      - Raise the auth email rate limit (the default is 2 an hour).
      - Site URL: the real domain. Redirect allow-list: `/reset/confirm` and
        `/account/email/confirm`.
      - Turn on **Secure email change**. Optionally, switch the "Change email
        address" template to a `{{ .TokenHash }}` link to
        `/account/email/confirm?token_hash=…`, so the link works on any device.
      - Check how long the auth audit log keeps sign-ins. If it keeps them,
        note it in `GDPR.md` §16.

### Payments — Stripe

- [ ] **1.9 — Register the webhook** `https://<domain>/api/stripe/webhook`
      (`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `invoice.payment_failed`), then set `STRIPE_WEBHOOK_SECRET`.
- [ ] **1.10 — Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`**:
      test-mode keys in Preview, live keys in Production. Advert payments need
      both, and so does the membership payment modal (GAPS B1.7): with only
      the secret key, signups fall back to Stripe's hosted page. The
      publishable key is baked in at build time, so redeploy after setting it.

### CRM — Bigin

- [ ] **1.15a — After the first Bigin sync, check the "From Bigin" box on
      `/console/sources`.** The story crawler reads the Companies field "News
      Page URL" as `News_Page_URL` (`NEWS_PAGE_FIELD` in
      `src/lib/adapters/crm.ts`), and falls back to the company's Website when
      it's blank. Bigin shows no API names in its settings (checked 5 Nov), so
      the name can only be confirmed by a sync. If the box shows the red "No
      Bigin company came back with a News Page URL" warning, the name is
      probably wrong: nothing is added or paused, and the real name has to be
      found through Bigin's field API, which needs a settings-read scope added
      to the token. Otherwise, read the count "using their Website": every one
      is a homepage checked daily, so expect more suggestions than from news
      pages alone (3.7 covers the first-week review).

### Social — Buffer

- [ ] **1.16 — Create a Buffer API key** (organisation owners only) and set
      `BUFFER_ACCESS_TOKEN` in the **Production scope only**. On Preview it
      would post preview links to SMI's real accounts.
- [ ] **1.17 — Enter the Buffer channel ids** at `/console/stories` → "Buffer
      channels". Until then, every post fails closed.

### Social reach — follower counts ([#4](https://github.com/luizafontanab/smi-app/issues/4))

Each one is optional and independent. Until a platform's credentials are set,
its row on `/console/social-reach` says "Not connected: enter by hand" and the
admin types the figure in. Setting one turns on the daily fetch of that
platform's follower count. The homepage figure stays whatever the admin types,
whatever is set here. Endpoints and token lifetimes: `docs/social-reach.md`.

- [ ] **1.23 — Facebook Page token.** Create a Meta developer app (Business
      type; Standard Access, no App Review, because only Page admins use it),
      add `pages_read_engagement` and `pages_show_list`, then exchange a
      long-lived user token for a **long-lived Page token** for the SMIUK Page.
      Set `FACEBOOK_PAGE_ID` and `FACEBOOK_PAGE_ACCESS_TOKEN` (Production
      only). Turns on: the Facebook row's followers fetched daily. The token has
      no fixed expiry, but Meta can invalidate it; the row then shows the error
      and the last good value.
- [ ] **1.24 — Instagram token.** In the same Meta app, add Instagram (API with
      Instagram Login), connect the sheetmetalindustries business account with
      `instagram_business_basic`, and generate a long-lived token. Set
      `INSTAGRAM_ACCESS_TOKEN` (Production only) **the same day you generate
      it**: the app assumes it's new and refreshes it weekly from then on,
      storing the refreshed token in the database. Turns on: the Instagram row's
      followers fetched daily. If a refresh fails, the `social_followers` job
      fails into "Needs You Today" with the days left; past 60 days without a
      refresh, generate a new token and set it again.
- [ ] **1.25 — YouTube API key.** In Google Cloud (the Maps project in 1.22 is
      fine), enable **YouTube Data API v3**, create an API key restricted to
      that API, and set `YOUTUBE_API_KEY` (Production only). Turns on: the
      YouTube row's subscriber count fetched daily. YouTube's terms forbid
      keeping a count over 30 days old, so if fetching stops for 30 days the
      count is cleared and the row asks for a figure by hand.

### Anthropic (the third-person rewrite)

- [ ] **1.21 — Create an SMI-owned Anthropic account and set `ANTHROPIC_API_KEY`**
      (Production and Preview). Until it's set, "Start story" still pre-loads
      the draft (text, summary, image, member link) but leaves the article in
      the company's own "we" wording, and the draft's notice says so. Create the
      account at console.anthropic.com in SMI's name, as with the other
      services, not a personal one. Set a monthly spend limit: each Start story
      costs roughly 3–8p, so £10 a month is ample.

### Google Maps (the directory, events and profile maps)

- [ ] **1.22 — Set up the old site's Google Maps key for this site.** Until it's
      set, the member directory's map, the events map and each member profile's
      map show "Map unavailable"; everything else on those pages works.
      In Google Cloud console → APIs & Services, for the key's project:
      - Enable the **Maps JavaScript API** and check billing is on (Google
        bills per map load after a free monthly credit).
      - Under the key's restrictions, set **HTTP referrers** to
        `https://sheetmetalindustries.com/*`, `https://*.sheetmetalindustries.com/*`,
        the Vercel Preview domain and `http://localhost:3100/*`, replacing the
        old site's domains if the old site is gone. Limit the key to the Maps
        JavaScript API. The key is public in every browser by design, so the
        restriction is what protects it.
      - Optional: create a Map ID (Map Management) and set
        `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Without it Google's demo map id is used.
      Then set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local` (restart
      `pnpm dev`) and in Vercel (Production and Preview). It is read at build
      time, so a redeploy is needed after setting it. Pin locations still come
      from OpenStreetMap (2.12), so no Geocoding API is needed.

### Vercel

- [ ] **1.18 — Set the remaining variables.**
      - `SITE_URL=https://sheetmetalindustries.com` (Production).
      - `UNSUBSCRIBE_SECRET`, at least 32 characters (Production and Preview).
      - `DEVELOPER_EMAILS`, your login email (otherwise `/console/errors` 404s).
      - `DEV_ALERT_EMAIL`, where error alerts go.
- [ ] **1.20 — Decide the production cron schedule.** `vercel.json` runs
      `/api/cron` once a day at 03:00. Per-minute or hourly needs the Pro plan,
      so check which plan the project is on. Everything queued waits for the
      next run: notifications, scheduled publishing, social posts, story-source
      checks.

**Done (28 Oct):** 1.1 Resend account confirmed SMI-owned · 1.2 sending domain
`sheetmetalindustries.com` verified · 1.4 `EMAIL_REPLY_TO` set · 1.8 SMI Stripe
account and £40/month Price created, `STRIPE_PRICE_ID` set. Staging-only items
1.3, 1.11, 1.12 and 1.19 moved to §7. **Done (5 Nov):** 1.13–1.15 Bigin
connected to SMI's real account: Self Client, refresh token with the four
scopes, and the `BIGIN_*` variables in Vercel Production only (never Preview:
Bigin has no test mode).

---

## 2 · Push to production

`supabase db push` applies every pending migration in one go; you can't push
just one. Deploy the `staging` code at the same moment: old code against the new
schema breaks member profiles, the directory and the CRM page. Nothing is
pending, as far as this repo knows. Everything through `20261027000004` was
pushed to `bvyxeujhecxulzwvpxfr` on 28 Oct, without the backup or pre-checks
below; `20261028000001` and `20261029000001` followed on 4 Nov, and
`20261105000001`–`04` (Bigin Website fallback; issue #43's per-channel social
confirm, which marked every story and video already Live "Don't post") on
5 Nov. Push from a checkout of `staging`: a push from an older branch only
sees that branch's migrations. The "failed to cache migrations catalog"
warning at the end of a push comes after the migrations apply and is harmless.
Confirm with `supabase migration list --linked`. From `20261020000005` on, nothing sends
until it is approved in the console: any newsletter issue already *scheduled*
when it lands is marked approved so it still goes out, but a draft must go
through Proof and approval first.

- [ ] **2.1 — Take a Supabase backup** (Dashboard → Database → Backups).
- [ ] **2.2 — Run the pre-checks and resolve what they return.** Void duplicate
      issued invoices (keep the newest), withdraw duplicate renewals, and merge
      colliding contacts by hand.
      ```sql
      -- one issued invoice per booking / bundle / placement
      select 'booking' k, advert_booking_id, string_agg(number, ', ') from invoices where status='issued' and advert_booking_id is not null group by 2 having count(*)>1
      union all select 'bundle', bundle_id, string_agg(number, ', ') from invoices where status='issued' and bundle_id is not null group by 2 having count(*)>1
      union all select 'placement', placement_id, string_agg(number, ', ') from invoices where status='issued' and placement_id is not null group by 2 having count(*)>1;
      select number, id from invoices where num_nonnulls(advert_booking_id, bundle_id, placement_id) > 1;
      -- bundle parts that will be un-priced (expected: none)
      select b.id, b.bundle_id, b.price_pennies from advert_bookings b
       where b.bundle_id is not null and b.price_pennies is not null
         and not exists (select 1 from invoices i where i.advert_booking_id = b.id);
      -- contacts whose emails collide once lowercased
      select count(*) from contacts where email <> lower(btrim(email));
      select lower(btrim(email)) addr, array_agg(id), array_agg(email) from contacts group by 1 having count(*) > 1;
      -- one pending member renewal per run
      select renewed_from, count(*) from advert_bookings
       where renewed_from is not null and status = 'awaiting_approval' and source = 'member'
       group by 1 having count(*) > 1;
      ```
- [ ] **2.3 — Deploy and push together:** `pnpm db:push:prod`. Once there is
      real traffic, push outside busy hours: one migration builds an index on
      `analytics_events` that locks every partition while it runs.
- [ ] **2.4 — Run the industries backfill straight away.** The migration clears
      every industry assignment. Run `pnpm industries:backfill:prod -- --dry-run`
      and compare the primaries with: Automation 23 · Welding 22 · Machinery 18 ·
      Bending 16 · Inspection 10 · Software 7 · Grinding 6 · Subcontractor 6 ·
      Processing 5 · Events 2 · none 8. If they match, run
      `pnpm industries:backfill:prod`.
- [ ] **2.5 — Normalise contact emails:** `select * from normalise_contact_emails();`.
- [ ] **2.6 — Import the story sources:** `pnpm sources:import:prod` (724 sources;
      safe to re-run). Then turn on **Story crawler** in `/console/features`:
      it ships off, and while it's off no source is checked and Bigin's News
      Page URLs aren't synced.
- [ ] **2.7 — Check the result:** run `pnpm verify:prod`, then two SQL checks.
      - `select polname from pg_policy where polrelid = 'members'::regclass;`
        must include `public_read_active_members`.
      - `select category, kind, count(*) from inbox_messages group by 1,2;`
        must show no real enquiry filed as a notification.
- [ ] **2.8 — Upload a photo over 4.5 MB as a story cover, and a PDF over 4.5 MB
      in Resources**, on the live site, the same day. Hosted Supabase must accept
      the browser's direct upload. If it doesn't, every upload fails.
- [ ] **2.9 — Re-run the static pages:** `pnpm seed:prod -- --pages-only`. It
      overwrites console edits to those pages, so copy any real edits into
      `scripts/lib/static-page-content.ts` first.
- [ ] **2.10 — Check for an edited newsletter shell:**
      `select kind, updated_at from email_templates where kind = '_newsletter_shell';`
      An edited shell keeps its own markup, so the new layout (gap review area
      5) loses its masthead, preview text and phone stacking. If a row comes
      back, open `/console/email-templates/_newsletter_shell` and reset it, or
      add `{{masthead}}` and `{{preheader}}` by hand. Since 21 Oct (gap review
      area 6) it also lacks the new footer, and a re-save needs `{{postal_address}}`
      and `{{reason_line}}`, so resetting it is simpler.
      Check the member-email wrapper the same way (`kind = '_shell'`). An edited
      one keeps a fixed footer that tells contact-form enquirers they have a
      member account (GAPS B3.4). The Email Templates list flags it; reset it,
      or put `{{footer}}` where the footer text is.
- [ ] **2.11 — Fill in the newsletter footer** under `/console/newsletter` →
      Footer once Jas has given the postal address (ask-jas 32). Until then every
      issue goes out without one, and the issue page says so.
- [ ] **2.12 — Fill in members' map pins:** `pnpm coordinates:backfill:prod -- --dry-run`,
      then without `--dry-run`. Only members with an address and no coordinates
      are looked up (about 18 of the 123 imported); typed-in pins are never
      touched. It looks each one up on OpenStreetMap, one a second, and lists
      any it couldn't place: fix those addresses in the console. Until it runs,
      those members show no map on their page or in the directory's Map view.
      Safe to re-run. *(Committed in `ed26f92`.)*

---

## 3 · First live run — check each service once

- [ ] **3.1 — Resend.**
      - Send to `delivered@resend.dev`, `bounced@resend.dev` and
        `complained@resend.dev` before any real address (they count against
        quota).
      - The first newsletter: if the request shape is wrong, the issue shows
        `send_failed` with the error.
      - Check opens are tracked; otherwise `opens_count` stays 0.
      - Before the first `newsletter_sync`, compare the Resend segment with the
        subscribed contacts. The sync removes addresses that aren't subscribed
        contacts.
      - `bounced@resend.dev` must show "bounced, not mailed" on its CRM contact,
        **not** unsubscribed (since 21 Oct, GAPS B5.12).
      - Every send now reads the segment first and refuses if it can't (GAPS
        B5.12). If the first issue fails with "Couldn't read the Resend
        segment", the listing endpoint's shape is the suspect
        (`segmentMembers` in `src/lib/adapters/newsletter.ts`).
      - Tick "address fixed" on the `bounced@resend.dev` contact, run
        `newsletter_sync`, and check the address is back in the Resend segment.
        The add call (`POST /contacts/{email}/segments/{id}`) mirrors the
        documented removal and has never run against a live account.
- [ ] **3.2 — Stripe.**
      - One test subscription and one declined card. `invoice.payment_failed`
        must find the member.
      - The membership payment opens as a modal on `/dashboard/pay`, not a
        redirect (GAPS B1.7). Pay with `4242 4242 4242 4242`: the member lands
        on the dashboard's "Payment sorted" banner, Billing shows a paid
        SMI-JOIN invoice, and the console inbox has one "Payment taken" note,
        not two. Closing the modal and paying again must also work.
      - One advert payment with `4242 4242 4242 4242`, and one 3-D Secure
        payment with `4000 0025 0000 3155`. Check: the run is "scheduled", the
        invoice is "paid" on both sides, and the webhook answers 200.
      - Re-opening the pay page must reuse the same Checkout Session.
      - A payment taken for a cancelled or already-paid invoice must appear in
        the console inbox; refund it by hand.
      - The old site's existing subscriptions must stay untouched.
- [ ] **3.3 — Bigin** (on the throwaway account first, 1.12).
      - An added contact appears with the right name, company and opt-out.
      - Adding a contact Bigin already has updates it rather than duplicating it.
      - Unsubscribing here sets *Email Opt Out* there.
      - An edit made in Bigin arrives here within a minute.
      - The "Last sync" line shows no live-updates error.
      - A PUT to a deleted contact fails safely.
      - Deleting a race-created duplicate (`?wf_trigger=false`) works with the
        granted scopes.
- [ ] **3.4 — First Bigin import, with Jas, before the next newsletter.** In
      `/console/crm`, click **Preview import**, read the counts, then **Run first
      import**. Imported contacts are subscribed unless they opted out in Bigin,
      so the next issue goes to them.
- [ ] **3.5 — Buffer.**
      - Confirm `SHARE_MODE` / `SCHEDULING_TYPE` (`"shareNow"` / `"custom"` in
        `src/lib/adapters/social.ts`) mean *post now*: introspect the schema,
        or make one test post.
      - Check the first post's image rendered.
      - Check the story's LinkedIn / Facebook / X post links fill in on their own
        within a few cron runs (GAPS B4.6). They come from Buffer's
        `externalLink`, which is in its API reference but has never been seen on a
        live response. If they stay empty, look at the `social_links` jobs; a link
        can still be pasted by hand meanwhile.
      - Check that the organisation id is filled in next to the channel ids on
        `/console/stories`. Then open any story's editor: under "Social post"
        each channel's preview should be named by its network (LinkedIn, X, …)
        and carry only that network's tags (GAPS B4.5, issue #43). The network
        comes from Buffer's `channels(input: { organizationId })` → `service`,
        which is in its API reference but untested. Previews named "Channel …"
        mean there is no organisation id (every channel then gets one shared
        text cut to fit X's 280); a red "confirming is off" note means the
        lookup itself is failing.
      - Nothing posts until a channel is confirmed in the editor (issue #43).
        Confirm one channel on the first live story and check it went out on
        that channel only.
      - Confirm X really refuses a post over 280 through Buffer (as a
        `MutationError`) rather than truncating it. Our counting treats every
        link as 23 characters.
- [ ] **3.6 — Login-email change.** Do one end to end after 1.7. Check whether
      one link or both are needed, and that the member lands back in Settings.
      *Locally (29 Oct): either link alone switches the address and lands on
      Settings; the other then fails with "link invalid or expired" and lands
      on the dashboard with no message (GAPS A4.12). Note which way the hosted
      project behaves: that decides the fix.*
- [ ] **3.7 — Story sources, after the first week.** Review the "Blocked",
      "News page gone" and "Nothing readable found" filters. Cancel ChangeTower
      only after that: about 20% of sources still need checking by hand.
- [ ] **3.8 — Newsletter layout in real inboxes.** Before the first issue in the
      new layout goes out, send a test (issue page → "Send me a test") to a
      Gmail, an Outlook desktop and a phone inbox. Check the masthead logos, the
      two-up cards (Outlook desktop may keep them side by side on a phone-sized
      window, which is acceptable), the "Sponsored" banners between rows, and
      that the preview text shows under the subject.
- [ ] **3.9 — Get the agency's Mailchimp export and reconcile it, after 3.4 and
      before the first newsletter** (gap review area 7, GAPS B5.13). The list
      is Formation Media's Mailchimp audience, not SMI's, so Jas has to ask them
      for the **full audience export: subscribed, unsubscribed and cleaned**, the
      zip Mailchimp gives you under Audience → Export. Without it, anyone who
      unsubscribed in Mailchimp but never in Bigin gets the first issue from
      here, which is a PECR breach. Unzip it **outside the project**, then run
      `pnpm contacts:import-mailchimp:prod <dir>` (a dry run). Check the column
      names were recognised (no "no Email Address column" lines) and the counts
      look right, then re-run with `--apply`. Delete the export afterwards: it's
      personal data. New contacts and opt-outs reach Bigin 50 per `crm_sync` run.
      The cutover top-up is GO-LIVE 2.4.
- [ ] **3.10 — Check the first build runs on Node 24.** `package.json` now sets
      `"engines": { "node": "24.x" }` (28 Oct), which overrides the Node version
      in Vercel → Project Settings → Build and Deployment. In the first build
      log, check that Node is 24.x and that Vercel warns the dashboard setting
      was overridden. If the dashboard still says 20.x or 22.x, change it to
      24.x so it no longer contradicts the repo. *(`08e6c93`.)*
- [ ] **3.11 — Check the lead-alert email wasn't customised.** The alert now
      reports page views, not companies (#12). In the console, open Email
      templates and look at the lead alert. If it shows as customised, any
      field using `{{count}}` or `{{companies_phrase}}` is already ignored, but
      wording with no placeholder (for example a subject about "companies")
      still sends. Reset the email or reword it.

---

## 4 · Decisions for Jas

- **4.1 — Newsletter deliverability.** Moved to [#23](https://github.com/luizafontanab/smi-app/issues/23) on 3 Nov 2026.
- **4.2 — Terms pages.** Moved to [#24](https://github.com/luizafontanab/smi-app/issues/24) on 3 Nov 2026.
- **4.3 — Social reach figure.** Moved to [#4](https://github.com/luizafontanab/smi-app/issues/4) on 3 Nov 2026.
- **4.5 — Unpaid advert holds.** Moved to [#17](https://github.com/luizafontanab/smi-app/issues/17) on 3 Nov 2026.
- **4.6 — Lapsed members' stories.** Moved to [#18](https://github.com/luizafontanab/smi-app/issues/18) on 3 Nov 2026.
- **4.7 — Newsletter adverts use the mobile artwork.** Moved to [#19](https://github.com/luizafontanab/smi-app/issues/19) on 3 Nov 2026.
- **4.8 — Approve the 9 imported legacy adverts.** Moved to [#25](https://github.com/luizafontanab/smi-app/issues/25) on 3 Nov 2026.
- **4.9 — The WordPress agency's liquidation and the hosting takeover.** Moved to [#26](https://github.com/luizafontanab/smi-app/issues/26) on 3 Nov 2026.
- [ ] **4.10 — Send Jas the "no industry" report** after 2.4:
      `pnpm industries:backfill:prod -- --dry-run --report`.
- [ ] **4.11 — Tell Jas, with the deploy:**
      - banner impressions step up (three adverts rotate per position);
      - "site users this year" double-counts returning visitors until old rows
        age out;
      - SMI's own post links on each story now fill in from Buffer; there is
        nothing to paste (a pasted link is never replaced);
      - the homepage's Featured event card is now bookable under Adverts →
        Featured Event, with a backup event to pin. Until something is booked
        or pinned it shows the next upcoming event, as before.
- **4.12 — Decide when industries go back on the public site.** Moved to [#20](https://github.com/luizafontanab/smi-app/issues/20) on 3 Nov 2026.

**Done:** 4.4 answered "sellable" (27 Oct): Featured Event is a dated, optionally
priced placement, one at a time, billed to the event's member, with a pinned
backup event (`/console/adverts/featured-event`). *(`aefe096`.)*

4.1, 4.5, 4.6 and 4.7 don't depend on the deploy and can be settled any time.

## 5 · Content to upload

- **5.1 — Brand-pack assets.** Moved to [#27](https://github.com/luizafontanab/smi-app/issues/27) on 3 Nov 2026.
- **5.2 — Example images for the advert formats.** Moved to [#28](https://github.com/luizafontanab/smi-app/issues/28) on 3 Nov 2026.

Both can go up any time; neither waits for the deploy.

---

## 6 · Yours

- [ ] **6.1 — Before launch, delete the test logins** `admin@smi.test` and
      `member@smi.test` (and the draft company `smi-test-company`).
- [ ] **6.3 — Review the release notes** (`src/content/release-notes.md`)
      before each deploy, and add an entry with it. The edits this item first
      pointed at were committed in `aefe096`.

**Done (28 Oct):** 6.5 the join spec gives every test its own synthetic
`x-forwarded-for` IP, so repeat runs no longer hit the 3-an-hour limit and the
limiter stays unchanged. Not deploy-related items 6.2, 6.4, 6.6, 6.7 and 6.8
moved to §7.

---

## 7 · Not tied to the deploy

Nothing here blocks the production deploy or the cutover. Items keep their
original numbers, because other items and docs refer to them.

### Staging and Preview

- [ ] **1.3 — Verify a staging subdomain** (e.g. `staging-mail.`) and set a
      domain-restricted, sending-only key in the Preview scope. Resend has no test mode.
- [ ] **1.11 — Leave `MOCK_INTEGRATIONS` unset on Preview** and use Stripe's
      test-mode keys there instead. The flag mocks Stripe *and* Bigin together,
      so with it on, 1.12's test account is never called.
- [ ] **1.12 — Start with a throwaway Bigin account** on the free plan (5,000
      API calls a day). Bigin has no test mode: real keys write to real
      contacts. Do 1.13–1.14 for it, put its keys in **Preview** only, and run
      3.3 against it.
- [ ] **1.19 — Turn on Deployment Protection for Preview deployments.**

### Housekeeping

- [ ] **7.1 — Replace `SUPABASE_ACCESS_TOKEN` in `.env.production.local`.**
      Supabase rejects it ("Invalid access token", found 28 Oct). Loading the
      file overrides your `supabase login`, so every script that sources it
      fails against the hosted project: `pnpm seed:prod` and the other
      `:prod` scripts, and any `supabase` command run after sourcing it. Make a
      new personal access token in the account that owns `bvyxeujhecxulzwvpxfr`.
- **7.2 — Move to Node 26 once Vercel supports it.** Moved to [#9](https://github.com/luizafontanab/smi-app/issues/9) on 3 Nov 2026.
- **6.2 — Correct production's `consent_stats`.** Moved to [#10](https://github.com/luizafontanab/smi-app/issues/10) on 3 Nov 2026.
- **6.4 — Version-control `handover-extract/`.** Moved to [#29](https://github.com/luizafontanab/smi-app/issues/29) on 3 Nov 2026.
- **6.6 — Review and accept the visual baselines.** Moved to [#30](https://github.com/luizafontanab/smi-app/issues/30) on 3 Nov 2026.
- [ ] **6.7 — Set `CRON_SECRET` in `.env.local`** if you want the local job
      runner (`scripts/job-runner.ts`).
- **6.8 — Move `docs/stripe_backup_code.txt` out of the repository.** Moved to [#31](https://github.com/luizafontanab/smi-app/issues/31) on 3 Nov 2026.

---

## Notes (no action)

- `script-src 'unsafe-inline'` stays for now (`next.config.ts`). When nonces
  arrive, the JSON-LD tags need them too.
- The visual baselines are about 24 MB in plain git. Git LFS is the option if
  re-baselining gets frequent.
- Outside this list: MaxMind/GeoLite2, the GitHub/Vercel/Supabase ownership
  transfers and the London-region Supabase project are tracked in `README.md`
  ("Outstanding") and `GAPS.md` Part B.
