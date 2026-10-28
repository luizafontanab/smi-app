# Human to-do — things Claude can't do

Steps that need a person: external accounts, keys, hosted-dashboard settings,
production data, and decisions. The code for each is written and merged.

**How this list works.** Ordered by when things happen: set up the services,
push to production, check each service the first time it runs for real, then
the decisions. Finished items are deleted, and git keeps the history.
Renumbered on 20 Oct 2026. Older references (GAPS, code comments, migrations,
commits) use the previous numbers, which are in `git show d89aee9:docs/HUMAN-TODO.md`.

Creating accounts, deploying, sending real email and calling paid APIs need
approval (`../requirements/BUILD-PLAN.md`).

---

## 1 · Set up the services

Each service is independent; do them in any order.

### Email — Resend

- [ ] **1.1 — Confirm the Resend account is SMI-owned**, not an agency's.
      `RESEND_API_KEY`, `EMAIL_FROM` and `ADMIN_EMAIL` are already set in production
      (5 Oct).
- [ ] **1.2 — Verify the sending domain** `sheetmetalindustries.com` (SPF, DKIM,
      DMARC). Until then, mail reaches only the Resend account owner.
- [ ] **1.3 — Verify a staging subdomain** (e.g. `staging-mail.`) and set a
      domain-restricted, sending-only key in the Preview scope. Resend has no test mode.
- [ ] **1.4 — Choose and set `EMAIL_REPLY_TO`**, a monitored inbox. Without it,
      replies go to `noreply@`. Since 21 Oct (GAPS B5.11) this is the newsletter's
      reply-to too, which the SOP requires.
- [ ] **1.4a — Set `NEWSLETTER_FROM`** to `Sheet Metal Industries <…@sheetmetalindustries.com>`
      (an address on the verified domain, 1.2). The SOP wants that sender name;
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
        key. Needs 1.2 first.
      - Raise the auth email rate limit (the default is 2 an hour).
      - Site URL: the real domain. Redirect allow-list: `/reset/confirm` and
        `/account/email/confirm`.
      - Turn on **Secure email change**. Optionally, switch the "Change email
        address" template to a `{{ .TokenHash }}` link to
        `/account/email/confirm?token_hash=…`, so the link works on any device.
      - Check how long the auth audit log keeps sign-ins. If it keeps them,
        note it in `GDPR.md` §16.

### Payments — Stripe

- [ ] **1.8 — Create the SMI-owned Stripe account** and the £40/month
      subscription Price, then set `STRIPE_PRICE_ID`.
- [ ] **1.9 — Register the webhook** `https://<domain>/api/stripe/webhook`
      (`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
      `invoice.payment_failed`), then set `STRIPE_WEBHOOK_SECRET`.
- [ ] **1.10 — Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`**:
      test-mode keys in Preview, live keys in Production. Advert payments need
      both. The publishable key is baked in at build time, so redeploy after
      setting it.
- [ ] **1.11 — Leave `MOCK_INTEGRATIONS` unset on Preview** and use Stripe's
      test-mode keys there instead. The flag mocks Stripe *and* Bigin together,
      so with it on, 1.12's test account is never called.

### CRM — Bigin

- [ ] **1.12 — Start with a throwaway Bigin account** on the free plan (5,000
      API calls a day). Bigin has no test mode: real keys write to real
      contacts. Do 1.13–1.14 for it, put its keys in **Preview** only, and run
      3.3 against it.
- [ ] **1.13 — Create the SMI-owned Bigin account** and an OAuth client in the
      Zoho API Console. Note its data centre: the code defaults to EU
      (`accounts.zoho.eu` / `www.zohoapis.eu`); Canada's accounts host is
      `accounts.zohocloud.ca`.
- [ ] **1.14 — Generate a refresh token.** In the Zoho API Console, use a Self
      Client → Generate Code → portal **Bigin**, then exchange the code within
      its 3–10 minutes. Scopes:
      `ZohoBigin.modules.contacts.ALL,ZohoBigin.modules.accounts.READ,ZohoSearch.securesearch.READ,ZohoBigin.notifications.ALL`
- [ ] **1.15 — Set the Production variables:** `BIGIN_CLIENT_ID`,
      `BIGIN_CLIENT_SECRET`, `BIGIN_REFRESH_TOKEN`, `BIGIN_WEBHOOK_TOKEN` (any
      random string ≤ 50 characters), plus `BIGIN_ACCOUNTS_BASE` /
      `BIGIN_API_BASE` if the account isn't in the EU.
- [ ] **1.15a — Confirm the API name of the Companies field "News Page URL".**
      In Bigin: Settings → Developer Space → APIs → API Names → Companies. The
      story crawler assumes `News_Page_URL` (`NEWS_PAGE_FIELD` in
      `src/lib/adapters/crm.ts`). If it's different, change that one constant.
      With a wrong name, no Bigin sources arrive, because every company reads
      as having no URL. Nothing already added is paused, though: a read with no
      URLs at all is treated as suspect. The scope is already in 1.14's list.

### Social — Buffer

- [ ] **1.16 — Create a Buffer API key** (organisation owners only) and set
      `BUFFER_ACCESS_TOKEN` in the **Production scope only**. On Preview it
      would post preview links to SMI's real accounts.
- [ ] **1.17 — Enter the Buffer channel ids** at `/console/stories` → "Buffer
      channels". Until then, every post fails closed.

### Vercel

- [ ] **1.18 — Set the remaining variables.**
      - `SITE_URL=https://sheetmetalindustries.com` (Production).
      - `UNSUBSCRIBE_SECRET`, at least 32 characters (Production and Preview).
      - `DEVELOPER_EMAILS`, your login email (otherwise `/console/errors` 404s).
      - `DEV_ALERT_EMAIL`, where error alerts go.
- [ ] **1.19 — Turn on Deployment Protection for Preview deployments.**
- [ ] **1.20 — Decide the production cron schedule.** `vercel.json` runs
      `/api/cron` once a day at 03:00. Per-minute or hourly needs the Pro plan,
      so check which plan the project is on. Everything queued waits for the
      next run: notifications, scheduled publishing, social posts, story-source
      checks.

---

## 2 · Push to production

`supabase db push` applies every pending migration in one go; you can't push
just one. Deploy the `staging` code at the same moment: old code against the new
schema breaks member profiles, the directory and the CRM page. Pending, as far
as this repo knows: `20261004000002` through `20261027000004`. Confirm with
`supabase migration list --linked`. From `20261020000005` on, nothing sends
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
        `/console/stories`. Then check the first post on each network carries only
        that network's tags (GAPS B4.5). The network comes from Buffer's
        `channels(input: { organizationId })` → `service`, which is in its API
        reference but untested. If X shows `linkedin:` tags too, the lookup is
        failing, and every channel gets one shared text cut to fit X's 280.
        That's safe, but untidy.
      - Confirm X really refuses a post over 280 through Buffer (as a
        `MutationError`) rather than truncating it. Our counting treats every
        link as 23 characters.
- [ ] **3.6 — Login-email change.** Do one end to end after 1.7. Check whether
      one link or both are needed, and that the member lands back in Settings.
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

---

## 4 · Decisions for Jas

- [ ] **4.1 — Newsletter deliverability.** Run a real send to trade addresses,
      compared with MailChimp on getting through firewalls and on open rates.
      Then record the winner in TECH-DECISIONS #7.
- [ ] **4.2 — Terms pages.** Six `[SMI TO CONFIRM]` markers show on the live
      pages: VAT, company details, refunds, artwork deadline, advertising
      cancellation, governing law.
- [ ] **4.3 — Social reach figure.** "347,000" is hard-coded in the grid
      homepage stats band (`src/components/grid-home/cards.tsx`). Give the real
      number, or drop the stat.
- [ ] **4.5 — Unpaid advert holds** keep their dates until the term ends, with
      no reminder. Should there be a reminder or an earlier expiry?
- [ ] **4.6 — Lapsed members' stories** stay live, without the directory
      backlink. Confirm, or take them down.
- [ ] **4.7 — Newsletter adverts use the mobile artwork.** Confirm.
- [ ] **4.8 — Approve the 9 imported legacy adverts** (Command Centre). Before
      approving, know that:
      - each member gets two emails;
      - White Cross, Yorgrip and HPC Laser are lapsed members;
      - the White Cross and Yorgrip "logos" are really banners.
- [ ] **4.9 — The WordPress agency's liquidation and the hosting takeover.**
      Depends on Jas's call with the agency.
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

**Done:** 4.4 answered "sellable" (27 Oct): Featured Event is a dated, optionally
priced placement, one at a time, billed to the event's member, with a pinned
backup event (`/console/adverts/featured-event`). *(Working tree, uncommitted.)*

## 5 · Content to upload

- [ ] **5.1 — Brand-pack assets** at `/console/resources`. The library starts
      empty.
- [ ] **5.2 — Example images for the advert formats** at `/console/advertising`.
      The `/advertising` cards show none until then.

---

## 6 · Yours

- [ ] **6.1 — Before launch, delete the test logins** `admin@smi.test` and
      `member@smi.test` (and the draft company `smi-test-company`).
- [ ] **6.2 — Correct production's `consent_stats`** for two requests made by a
      local production build on 15 Oct:
      `update consent_stats set total_requests = total_requests - 2 where day = '2026-10-15';`
      Then decide how to stop a local `next start` from loading
      `.env.production.local`.
- [ ] **6.3 — Review the release notes** (`src/content/release-notes.md`,
      uncommitted edits) before they ship. Add an entry with each deploy.
- [ ] **6.4 — Version-control `handover-extract/`.** The migration pipeline has
      no history. Keep `json/` and `seed/` out of git: they hold personal data.
- [ ] **6.5 — `tests/e2e/join.spec.ts` against the join rate limit** (3 per
      hour). Either the spec signs up less often, or the limiter changes.
- [ ] **6.6 — Review and accept the visual baselines.** Last accepted 22 Sep;
      every route has moved since, and new routes hard-fail until accepted.
      Run `pnpm visual`, look, then `pnpm visual:accept <route-id>` per route,
      never `--all`. Eight routes are skipped until the local data has content
      for them (see `tests/visual/manifest.ts`).
- [ ] **6.7 — Set `CRON_SECRET` in `.env.local`** if you want the local job
      runner (`scripts/job-runner.ts`).
- [ ] **6.8 — Move `docs/stripe_backup_code.txt` out of the repository** and
      into a password manager, then delete it here. Found untracked and
      unignored in the tree on 21 Oct (code review); it is gitignored now so it
      can't be committed by accident, but it shouldn't live on disk in a
      project folder either.

---

## Notes (no action)

- `script-src 'unsafe-inline'` stays for now (`next.config.ts`). When nonces
  arrive, the JSON-LD tags need them too.
- The visual baselines are about 24 MB in plain git. Git LFS is the option if
  re-baselining gets frequent.
- Outside this list: MaxMind/GeoLite2, the GitHub/Vercel/Supabase ownership
  transfers and the London-region Supabase project are tracked in `README.md`
  ("Outstanding") and `GAPS.md` Part B.
