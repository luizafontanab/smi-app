# Implementation gaps — Phase 1

Audited 31 Aug 2026 and reconciled 1 Sep. **Re-reconciled 27 Sep 2026** against the 18 Sep call, as written into [`USE-CASES.md`](../../requirements/USE-CASES.md) open-gaps rows 19–26 and the `[18 Sep]` lines of [`REQUIREMENTS.md`](../../REQUIREMENTS.md). The audit covers 70 use cases: V1–V18 + V11b, M1–M14, A1–A29, S1–S8.

**Part A** can be built today with no external account or key. **Part B** needs a third-party service wired. **Part C** covers honesty fixes owed because Part B is unfinished.

Every item is numbered so it can be referenced directly, for example "do A2.1 and A2.2". Tick items as they land and add the commit SHA next to each ticked item.

**Closed items live in [`GAPS-closed.md`](GAPS-closed.md)** (moved there 28 Oct 2026), one line per section, under the same headings. The full write-ups (what was built, trade-offs, what was found en route) are in git: `git show 320e28e:docs/GAPS.md` for items closed up to 27 Sep, `git show 5b2a9ad:docs/GAPS.md` for the A8/A9 pass closed 28 Sep. Only `fix-list.md` keeps ticked `[x]` items; every other list collapses them. Numbers are permanent and never reused, because code comments, tests and migrations cite them. When an item closes, remove its entry here and add it to its section's **Closed** line in `GAPS-closed.md`.

**Open items now live in GitHub Issues (since 3 Nov 2026).** An entry below that says *Moved to #N* is tracked and closed in that issue; it keeps its number here because code, tests, migrations and other docs cite it.

When an item is *coded but inert* pending an account, key or approval, the human step is in **[`HUMAN-TODO.md`](HUMAN-TODO.md)**. Open client questions are in **[`ask-jas.md`](ask-jas.md)**. Feature-parity scoping for the member area is in **[`legacy-members-admin-inventory.md`](legacy-members-admin-inventory.md)**.

---

## Part A — Buildable now, no third-party dependency

### A1 · Content & CMS CRUD

- **A1.5 (residual) — Specs for advertising formats B/C/D/F are still blank.** Moved to [#21](https://github.com/luizafontanab/smi-app/issues/21) on 3 Nov 2026.

### A2 · Advert & inventory management

*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

### A3 · Publishing pipeline & scheduling

- [ ] **A3.1 — Production cron runs once a day at 03:00**, while `src/lib/jobs.ts` assumes ticks every minute (`publish_scheduled` every 60s). Scheduled stories publish up to 24h late, the "~30 min later" social push lands at the next 03:00, and a newsletter scheduled for 10:00 sends the next morning. This degrades A6, S3 and every scheduled send. → `vercel.json`
  **Deferred (31 Aug 2026)** — not live yet, and a tighter cron means more invocations. Revisit before launch. The fix is one line.
  **Held again 28 Sep:** the SMI Vercel plan is unconfirmed, and Hobby allows only one cron run a day. A more frequent schedule would make deploys fail there. It stays daily until the plan is confirmed (HUMAN-TODO 13.1 has the options: every minute or hourly, both needing Pro).
  **20 Oct (A3.8):** each story and video now has its own social post time, shown in the editor in UK time. In production that time is only as precise as this cron: until it changes, a post set for 14:30 goes out at the next 03:00 UTC run.
### A4 · Member area

- **A4.12 (residual) — The second email-change link fails silently.** Moved to [#7](https://github.com/luizafontanab/smi-app/issues/7) on 3 Nov 2026.

### A5 · Reporting & analytics surfaces

*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

### A6 · Public site compliance & polish


*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

### A7 · Platform & admin

*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

### A8 · New requirements from the 31 Aug refresh

- **A8.3 — Admin lead-generation panel (A29): waiting only on the disclaimer sign-off (ask-jas §15).** Moved to [#11](https://github.com/luizafontanab/smi-app/issues/11) on 3 Nov 2026.
- **A8.4 — Member lead-generation panel (M14): same state as A8.3.** Moved to [#11](https://github.com/luizafontanab/smi-app/issues/11) (its lead-alert email follow-up: [#12](https://github.com/luizafontanab/smi-app/issues/12)) on 3 Nov 2026.

### A9 · New requirements from the 18 Sep call (USE-CASES gaps 19–26, REQUIREMENTS `[18 Sep]`)

Already done from this call, so no item: Industries pre-filter (gap 19; `industries` table since 10 Sep, `?industry=` on news/video/event/member, industries bar below the nav on grid) · event location + type (fix-list/A1.8) · in-dashboard help to Jas (`/dashboard/help`) · dropped card dates, bigger featured-member logos, "Become a Member" on the stats band, three-column grid fold with separated Featured Machine/Event (fix-list 64–68) · ad-format freeze (gap 25; `banner_narrow` hidden, fix-list 74) · reset-only password recovery (gap 22).

- **A9.11 — Nothing on the public site offers a member's email any more (V8).** Moved to [#13](https://github.com/luizafontanab/smi-app/issues/13) on 3 Nov 2026.
- **A9.7 — The stats digest defaults on, but the 18 Sep call says opt-in. This is a spec conflict to confirm, not a build.** Moved to [#14](https://github.com/luizafontanab/smi-app/issues/14) on 3 Nov 2026.

**Closed (all 28 Sep, `5b2a9ad`):** A9.1 /member filters facet against each other (`src/lib/member-facets.ts`) · A9.2 "Content reach" by type, plus the `video_view` event and the `member_event_months` RPC that fixed silent under-counting past `max_rows`; social half waits on D5 · A9.3 member news woven into the grid's More News carousel (forge half moot, grid going live) · A9.4 Featured Machine video + seller logo · A9.5 `search_members()` matches services and industry · A9.6 FAQ grouped, policies collapsible, membership terms in the footer (prod push: HUMAN-TODO 19.1) · A9.8 member advertising Assets tab (baseline: HUMAN-TODO 19.3) · A9.10 videos YouTube-only, and `youtubeId()` reads every YouTube link shape. The production migrations for A9.2/A9.4/A9.5 shipped 1 Oct (HUMAN-TODO 19.4). · A9.9 nav order: kept as is (22 Oct, Luiza). `GridSiteHeader.tsx` had gone; grid uses the shared `src/components/SiteHeader.tsx`, whose Media (News, Videos, Newsletters, Magazine, Advertising) and Members (Find a member, Join) menus, Featured Machine, Events and Search already sit beside the logo, with Industries below. The 18 Sep request for the old site's flat Home / News / Videos / Newsletters / Find a Member order is not adopted; no code change, no baselines moved.

---

## Part B — Blocked on a third-party integration

Several closed B items were written against documented APIs and **have never run against a live account**. Confirm each on its first real use:

- Stripe checkout, subscriptions and cancel (B1.1, B1.5)
- Buffer GraphQL enums (B4.4)
- Resend Broadcasts/Contacts (B5.1) and its webhook fields (A5.4)
- Bigin push, pull, opt-out and webhook (B6.4–B6.8)

### B1 · Stripe (payments)

- **B1.8 — Two open checkout sessions can mean two subscriptions.** Moved to [#5](https://github.com/luizafontanab/smi-app/issues/5) on 3 Nov 2026.

### B2 · GeoIP — MaxMind / GeoLite2

*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

### B3 · Email — Resend

- [ ] **B3.3 — ~~No key exists yet.~~ Key set in production; waiting on the sending domain.** All email is inert until an SMI-owned Resend account is created, the domain is verified (SPF/DKIM/DMARC) and `RESEND_API_KEY` is set. **5 Oct (Luiza):** `RESEND_API_KEY` is set in production and a test email went through. Domain verification is still to come (HUMAN-TODO 1.2). Until then, mail to anyone other than the Resend account owner is refused (403), so member, admin and auth mail is still effectively off. Creating accounts and sending real mail are approval-gated (`BUILD-PLAN.md`). See `.env.example`.
- **B3.4 — Supabase auth mail stays outside the template system (fix-list 63).** Moved to [#22](https://github.com/luizafontanab/smi-app/issues/22) on 3 Nov 2026.
- [ ] **B3.5 — Contrast and client-safety can't be machine-checked for edited email copy (fix-list 63).** The rule keeping brand orange off email body text is tested over the *shipped defaults* only. Console-edited HTML is not validated beyond "it renders and its placeholders exist". This is the accepted cost of full-HTML editing. The mitigations are the per-template preview and one-click reset. → `src/lib/email/defaults.ts`, `tests/unit/email-templates.test.ts`

### B4 · Social publishing — Buffer

- **B4.3 — Real LinkedIn @-tagging (S3).** Moved to [#6](https://github.com/luizafontanab/smi-app/issues/6) on 3 Nov 2026.

### B5 · Newsletter delivery


*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

### B6 · CRM — Bigin / Zoho

**Correction (7 Oct):** ~~B6.1 and B6.3 closed~~ — both were written against **Zoho CRM's** API (`/crm/v2/Contacts`), not Bigin's (`/bigin/v2/Contacts`), and Bigin search needs a `ZohoSearch.securesearch.READ` scope HUMAN-TODO §7 never asked for. They would have failed on the first live call. Rewritten as B6.4–B6.8 below. The sync was also one-way: nothing new in Bigin ever came back, and an unsubscribe here never reached Bigin.

---

## Part C — Honesty fixes owed because Part B is unfinished

*Nothing open. Closed items are in [`GAPS-closed.md`](GAPS-closed.md).*

---

## Not gaps — deferred by design

Per [`PHASE-1-TECHNICAL.md §04`](../../proposal/PHASE-1-TECHNICAL.md), these are deferred by design:

- Content OS and the kanban "suggested" column (module 6). **Story discovery built 20 Oct.** The ChangeTower replacement is `/console/sources`: 724 sources, read daily by feed, WordPress API, news-page HTML or sitemap, with new links becoming suggestions → "Start story" drafts. About 80% of the list is readable; [`story-sources.md`](story-sources.md) lists the rest. Suggestions live on their own page, not as a board column. ~~The rest of module 6 is still deferred: the tense/person rewrite, press-release and YouTube intake, and the in-tool article reader.~~ Correction (28 Oct): the rewrite and the article reader are now built (below); press-release and YouTube intake are still deferred. *(Committed in `d89aee9`.)* **Bigin as a second source list (27 Oct):** each Bigin company's News Page URL is synced daily (`source_bigin_sync`, `src/lib/sources/bigin.ts`, migration 20261027000004). A URL already on the list is linked, not duplicated. A changed or cleared URL pauses the old source only if Bigin alone added it, and a partial Bigin read never pauses anything. Each source is matched to a member (a contact linked to both, else the website domain; ambiguous → nobody), so "Start story" drafts arrive tagged. The cost: a Bigin-linked source's address can't be edited or removed in the console, only in Bigin. **Since 6 Nov (#55)** a company's News Page URL is edited in CRM's Companies box and written through to Bigin (pending until Bigin accepts it, retried on the `crm_push` path, kept over Bigin's copy by the company sync); disabled with "edit in Bigin for now" until the token has the Companies write scope. The whole crawler now sits behind the **Story crawler** flag (off by default). *(`aefe096`.)* **"Start story" pre-loads the draft (28 Oct):** it reads the article page for title, summary, body and cover (`src/lib/sources/article.ts`, `draft.ts`), rewrites them from "we" to third person with Claude (`src/lib/adapters/rewrite.ts`), links the member's first mention to their page, takes their industry, and keeps the pre-rewrite text in `story_originals` (migration 20261028000001, console-only), shown in the editor. The cost: a rewrite is kept only if tags, links and length (±20%) are unchanged, so a good rewrite of a heavily "we" text can still be rejected; Start story now takes seconds, not instant; and every click is a paid AI call once the key is set (HUMAN-TODO 1.21). Inert until then: drafts arrive pre-loaded but in the company's own wording. *(`c14393e`.)* **Tested live 28 Oct** on SMMT articles, which led to three fixes: theme labels and sign-up boxes are no longer read as text; "we" is always the company (it had once become "the UK"); and "I" becomes the writer only when the article names them, otherwise the company with a note in the editor. *(`4393956`.)* **"Check sources now" (5 Nov, #42):** a button on Command Centre and Story sources runs one source check inside the click, the same due-sources batch as the schedule, and reports what it checked, found and couldn't read. One check runs at a time (a lock in `settings.source_check_last`, `src/lib/sources/run.ts`, shared with the scheduled job); a check cut off for over 3 minutes stops blocking. The cost: Command Centre's time limit is now 120s, like Story sources', and a click makes the same outside requests as a scheduled run. *(Branch `source-check-now`.)* **The button skips the 20-hour rule (6 Nov):** a click reads the least recently checked active sources whether due or not; the summary counts against all active sources and says "no active sources" when the list is empty. The cost: repeat clicks re-read sites more than once a day.
- Named-company click identification (F·43, parked)
- The marketplace
- Tiered membership
- Trade contact-list building
- Survey capture and reporting
- From the 18 Sep call: multi-user/sub-account logins (REQUIREMENTS §19) and non-YouTube video hosts (gap 23)

These are not engineering gaps either, so they are tracked elsewhere:

- **The WordPress agency's liquidation and hosting takeover** (USE-CASES gap 26) is external and time-sensitive. → HUMAN-TODO §19.2.
- **Industries** became their own table, directly linked from stories, videos and events, on 10 Sep (migration `20260909000002`). On 12 Oct Jas's ten replaced ours and a member can be in several, with one primary (`20261012000001`, `member_industries`). Every assignment is backfilled from his mapping of Services and news topics (`scripts/lib/industry-map.ts`, `pnpm industries:backfill`); a story's industry is a snapshot, not a join. Production steps: HUMAN-TODO §26; open questions: ask-jas § Industries. *(Committed in `4f14b9b`.)* **2 Nov:** industries are now Jas's alone. Members never see or set one: the dashboard forms have no field, and their saves ignore any posted (new member content lands untagged). The public site shows them only behind the `industries_public` flag, which is off by default; `/industry/*` redirects to /news while off. Approving member content tags it with the industry the editor shows, or from the board with the member's own; approving a member's old page edit never changes their industries. See HUMAN-TODO 4.12. *(Committed in `f7ede08`, PR #2.)*

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

- **D2 — Region (C2 / B2).** Moved to [#15](https://github.com/luizafontanab/smi-app/issues/15) on 3 Nov 2026.
- **D4 — Unconfirmed spec gaps.** Moved to [#8](https://github.com/luizafontanab/smi-app/issues/8), [#16](https://github.com/luizafontanab/smi-app/issues/16), [#11](https://github.com/luizafontanab/smi-app/issues/11) (gap 5, gaps 11/13/15, gap 24) on 3 Nov 2026.
- **D5 — How is "social media reach" calculated?** Moved to [#4](https://github.com/luizafontanab/smi-app/issues/4) on 3 Nov 2026.
