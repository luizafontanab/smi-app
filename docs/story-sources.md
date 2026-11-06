# Story sources — the ChangeTower replacement

The first slice of the Content OS (`requirements/06-content-os.md`, "Story
discovery"). Jas's list of company news pages lives in the app; each is read
once a day; any article link that wasn't there before becomes a suggestion on
**Console → Content → Story Sources** (`/console/sources`). *Start story* turns
one into an ordinary admin draft and opens the editor; the approval gate is
unchanged. Nothing here publishes, and pausing the job leaves the manual flow
exactly as it was.

*(Committed in `d89aee9`, 20 Oct 2026.)*

## How a source is read

Each source is read the cheapest way that works, decided on its first check and
stored on the source (`content_sources.method`):

1. **Feed** — RSS/Atom, as the page advertises it, or at the usual WordPress,
   Squarespace, Shopify, Wix or HubSpot address.
2. **WordPress API** — `/wp-json/wp/v2/posts`.
3. **News page** — article links read off the listing's HTML (the
   `/SMI/content-sources/scraper` prototype's heuristics, ported).
4. **Sitemap** — new page addresses under the news path; the title is made from
   the address, since a sitemap has none.

After three failed reads the method is worked out again. A source that can't be
read any way is marked with why (`access`): **blocked**, **news page gone**,
**unreachable**, or **nothing readable found**. The console lists these under
filters rather than hiding them.

- **The first good read is a silent baseline.** What's already on a page isn't
  news, so suggestions start from the second read.
- **Old items found late aren't news either.** Anything dated more than 30 days
  before the previous good read is recorded quietly.
- **Links are unique across the whole list.** A site listed twice can't suggest
  the same article twice.
- **Dismissed links are kept**, so they never come back as new.

**Code:**
- `src/lib/sources/extract.ts` (parsing)
- `src/lib/sources/fetch.ts` (the one network call)
- `src/lib/sources/check.ts` (discovery and the job)
- `src/lib/sources/run.ts` (one check at a time, and the record of the last one)
- `src/app/console/sources/` (the page and its actions)
- migration `20261020000002_content_sources.sql`

## Running it

- **Import the list once per target:** `pnpm sources:import`, or
  `pnpm sources:import:prod` (HUMAN-TODO §30). The source is
  `scripts/seed-assets/content-sources.csv`. That's the 726-row
  `scraping-targets.csv`, which becomes 724 sources once two addresses that are
  the same page are merged. Re-running it leaves existing sources alone.
- **The `source_watch` job runs hourly.** Each run checks the least recently
  checked sources for about 45 seconds, 6 sites at a time, and each source is
  checked about once a day.
- **It depends on the cron (GAPS A3.1 / HUMAN-TODO §13.1).** Production's cron
  currently runs once a day, which reaches only one batch, roughly 100–300
  sources depending on how many need discovery. With an hourly cron the whole
  list is covered daily.
- **"Check sources now" (issue #42, 5 Nov 2026)** on Command Centre and Story
  sources runs the same batch inside the click (up to 55 seconds; both pages
  allow 120s). It ignores the once-a-day rule (6 Nov 2026): a click reads
  every active source, least recently checked first, so repeat clicks work
  through the list, and the record is marked `forced`. Every check, scheduled or clicked, goes through
  `runSourceCheck`: the record in `settings.source_check_last` is also a lock,
  so a second check while one runs is refused ("busy"). A scheduled job that
  finds it busy queues itself again for when the lock is sure to be free. A
  check that started over 3 minutes ago and never finished counts as
  abandoned and no longer blocks. The same record is the "Last check …" line
  on both pages.
- **The hard stop cancels, it doesn't just stop waiting.** At the budget plus
  5 seconds, sources still being read have their requests cancelled; they
  write nothing and stay due. The check waits for every one to wind down
  before it counts what's still due and releases the lock, so two checks never
  read the same site at once. If something still hasn't stopped 5 seconds
  later, the lock is left held until the 3-minute expiry rather than released
  early.
- **The user agent is honest:** `SMI-story-sources/1.0 (+<site url>)`. Sites
  that block automated requests are left blocked, never worked around.

## Sources from Bigin (27 Oct 2026)

Each Bigin company's **News Page URL** (Companies module, field API name in
`NEWS_PAGE_FIELD`, `src/lib/adapters/crm.ts`) is a second source list next to the
imported spreadsheet. When it's blank, the company's **Website** stands in
(5 Nov 2026, migration `20261105000001`): the source is marked
`bigin_from_website` and labelled "from website" on the console. A homepage
still reads well, because the checker tries the site's feed, WordPress API and
sitemap before the page's own links. The daily `source_bigin_sync` job (and "Sync from Bigin
now" on `/console/sources` → Sources, or "Sync companies" on `/console/crm`) runs the
**company sync** (6 Nov 2026, issue #50, `src/lib/crm-companies/sync.ts`). It first stores
every CRM company Bigin returns in `crm_companies`, address or not (shown in CRM's
Companies box), then derives sources from them exactly as before. For each company it:

- links a URL that's already on the list to the company, without adding a second row;
- adds a new URL as a source marked `bigin_only`, named after the company;
- when a company's URL changes or is cleared, removes the link from the old
  source and pauses that source if `bigin_only`. A page that's also on the
  spreadsheet keeps running, and a spreadsheet re-import clears `bigin_only`;
- never removes links or pauses anything after a partial read (Bigin refused a call
  part-way), or after a read that found no URLs at all while some are linked
  (a renamed field looks exactly like that);
- skips a URL that isn't an address, or that a second company also lists, and
  lists it on the console to be fixed in Bigin. A News Page URL always beats
  another company's Website for the same address;
- uses no Website at all in a read where no company has a News Page URL. That
  is what a misnamed field looks like, and falling back would swap every news
  page for a homepage. The console shows a warning instead, and nothing changes;
- when a company that was using its Website gets a News Page URL, the Website
  source is unlinked (and paused if `bigin_only`) and the news page added;
- matches each linked source to one member: through a contact linked to both
  the company and the member, otherwise through the member's website domain.
  If more than one member matches, no one is tagged. "Start story" on that
  source's suggestions makes a draft tagged with the member. Admin drafts
  aren't shown to the member. An admin can choose the member by hand in CRM's
  Companies box (Edit on the company, issue #53, `crm_companies.member_override_id`).
  That choice wins over both rules, ambiguous or not, on every sync, and is
  kept in the app only (Bigin has no member field). Clearing it goes back to
  the automatic match. Either way the source is re-tagged straight away.

A Bigin-linked source's address is changed or cleared in Bigin, not in the
console, because the next sync would undo a console edit. It can still be
paused in the console.

Both jobs sit behind the **Story crawler** flag in `/console/features`. The
flag is off by default, and while it's off nothing is checked or synced. The
one exception is "Sync companies" on CRM: it works with the flag off, so CRM
can always mirror Bigin, but then it only stores the companies and leaves
story sources untouched.

## "Start story" (28 Oct 2026)

*Start story* on a suggestion makes an admin draft pre-loaded from the article
page (`src/lib/sources/draft.ts`):

1. The page is fetched once (`fetchText`) and parsed (`src/lib/sources/article.ts`).
   - **Title:** `og:title`, with the site name removed.
   - **Summary:** `og:description` or the meta description.
   - **Cover:** `og:image`, downloaded with `fetchImage` and stored through `uploadImage`, which checks the bytes.
   - **Body:** the post's text container (`.entry-content`, `<article>` and so on), or else the element with the most paragraph text. Widgets are stripped inside it, and the result is sanitised like every story body. Outside images are dropped.
     Short loose labels outside any paragraph, heading or list (category, date,
     "Scroll to discover", "Back to all news"), newsletter sign-up boxes and
     headings left at the very end are dropped too (SMMT, 28 Oct).
2. Title, summary and body are rewritten from first to third person
   (`src/lib/adapters/rewrite.ts`, Claude Opus 5.5, low effort). The rewrite is
   kept only if it changed nothing else: the same tags, the same links, and a
   length within about 20% of the original. Otherwise the original wording
   stays and the editor says why. Without `ANTHROPIC_API_KEY` (HUMAN-TODO 1.21)
   this step is skipped.
   "We" always means the company. "I" becomes the writer's name only when the
   article's own text names them; a name it doesn't contain is rejected as a
   guess. The page's author tag isn't used, because on WordPress sites it's
   whoever posted the article (SMMT's CEO column names its web editor). Without
   a named writer, "I" becomes the company and the editor says so.
3. When the source is matched to a member, the first plain-text mention of
   their name (also tried without "Ltd", "Limited" and similar) links to their
   member page. The draft is tagged with them and takes their industry.
4. The pre-rewrite body is saved in `story_originals`, which is console-only
   (RLS with no policies). The editor shows it under "Original article text".

Every step fails on its own, and the draft is always made. What couldn't be
loaded is listed at the top of the editor (`?notice=`). On a sample of 20 local
suggestions (28 Oct), every page gave a body, 19 gave a summary and 14 an image.

## Coverage (one test run, 20 Oct 2026)

The whole list was run once through the prototype, then through feed, API and
sitemap probes, and then through a headless browser for whatever was left. By
the app's rules, **about 583 of 726 addresses (80%) are readable.**

| Best method | Sites |
|---|---|
| Feed or WordPress API | 425 |
| News-page HTML | 119 (including pages with only 1–2 links) |
| Sitemap | 39 |
| **Not readable** (listed below) | **143** |

A headless browser (Playwright) would add only about 12 of the 143. It isn't
used: it needs a separate always-on worker or a paid browser service, and it
doesn't get past the bot checks that account for most of the blocked group.

Known limits:
- **Feed quality varies.** Some feeds mix product pages with news, a few list
  site pages rather than posts, and some sources aren't in English (one is
  Italian).
- **Path filters only catch what the address says.** A vacancy at a plain
  address (e.g. `multifab.co.uk/project-coordinator/`) still shows as a
  suggestion, to be dismissed.
- **Much of the list is dormant.** Only 213 of the 399 dated feeds posted in the
  six months to 20 Oct. The console shows each source's latest post date.
- **Not built in this slice:**
  - `robots.txt` rules
  - conditional requests (ETag/Last-Modified)
  - language filtering
  - the article reader inside the tool
  - the tense/person rewrite (module 6 "Drafting")
  - press-release and YouTube intake

## Addresses not readable (snapshot, 20 Oct 2026)

From the coverage run, not from the app. Once the list is imported and the job
has run, the live picture is on `/console/sources` under each filter. Next
steps for Jas are in ask-jas 28.

### Blocked — the site refuses automated reading (68)

| Site | Address | Detail |
|---|---|---|
| accura.co.uk | https://www.accura.co.uk/latest-news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| adeysteel.co.uk | https://www.adeysteel.co.uk/news/page/1 | HTTP 403 — browser saw “Just a moment...” |
| adslaser.co.uk | https://adslaser.co.uk/blog/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| aetuk.com | https://www.aetuk.com/latest-news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| ajengineering.co.uk | https://www.ajengineering.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| alcoengineering.co.uk | https://www.alcoengineering.co.uk//blog | HTTP 403 — browser saw “Just a moment...” |
| allsops.co.uk | https://allsops.co.uk/news.php | HTTP 403 — browser saw “Robot Challenge Screen” |
| amob.co.uk | https://amob.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| armstrong-group.uk | https://armstrong-group.uk/news-2 | HTTP 403 — browser saw “Robot Challenge Screen” |
| blackrow.co.uk | https://www.blackrow.co.uk/news/latest-news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| bridmet.co.uk | https://bridmet.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| castingstechnology.com | https://www.castingstechnology.com/news-events/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| central-profiles.co.uk | https://www.central-profiles.co.uk/blog/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| cnc-world.co.uk | https://cnc-world.co.uk/news-case-studies/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| compassbusinessfinance.co.uk | https://www.compassbusinessfinance.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| corporate.arcelormittal.com | https://corporate.arcelormittal.com/media/news-articles | HTTP 403 — browser saw “Blocked” |
| cutlasercut.com | https://cutlasercut.com/blog/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| dimakin.co.uk | https://dimakin.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| directair.co.uk | https://www.directair.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| directeng.co.uk | https://www.directeng.co.uk/news/the-full-turnkey-project/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| dkmsheetmetal.co.uk | https://dkmsheetmetal.co.uk/news | HTTP 403 — browser saw “403 Forbidden” |
| dmdesignfabrication.co.uk | https://www.dmdesignfabrication.co.uk/latest-news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| dyfedsteels.co.uk | https://dyfedsteels.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| emsea.com | https://emsea.com/case-studies/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| emsea.com | https://emsea.com/news-events/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| faccin.com | https://www.faccin.com/news-and-events/ | HTTP 403 — browser saw “Attention Required! / Cloudflare” |
| fclaser.co.uk | https://www.fclaser.co.uk/blog/ | HTTP 403 — browser saw “Laser Cutting & Fabrication Insights / FC Laser” |
| glendaleengineering.co.uk | https://www.glendaleengineering.co.uk/news | HTTP 403 — browser saw “Whoops!” |
| graham-eng.co.uk | https://www.graham-eng.co.uk/news/ | HTTP 403 — browser saw “Just a moment...” |
| grailengineering.co.uk | https://grailengineering.co.uk/case-studies/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| heathyards.com | https://www.heathyards.com/latest-news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| hgg-group.com | https://hgg-group.com/about-us-hgg-3d-profiling/news-and-events/ | HTTP 403 — browser saw “Error 403 Forbidden” |
| hilltop-engineering.co.uk | https://www.hilltop-engineering.co.uk/blog | HTTP 403 — browser saw “Robot Challenge Screen” |
| iae.co.uk | https://iae.co.uk/news/ | HTTP 403 — browser saw “Just a moment...” |
| in-comm.co.uk | https://in-comm.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| interface-sppl.com | https://www.interface-sppl.com/index.php/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| jps-machinery.co.uk | https://www.jps-machinery.co.uk/news | HTTP 403 — browser saw “Just a moment...” |
| jslaserprofiles.com | https://jslaserprofiles.com/blog/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| lander.co.uk | https://www.lander.co.uk/news-and-socials/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| millerfabrications.com | https://millerfabrications.com/index.php/news | HTTP 403 — browser saw “Robot Challenge Screen” |
| norwood.co.uk | https://norwood.co.uk/old-posts/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| onesite-laser.co.uk | https://onesite-laser.co.uk/blog/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| orangeboxfinishing.co.uk | https://orangeboxfinishing.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| pabgroup.co.uk | https://www.pabgroup.co.uk/news/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| pegasusprecision.co.uk | https://pegasusprecision.co.uk/the-latest-news-from-pegasus-precision/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| penn-elcom.com | https://www.penn-elcom.com/blog/category/latest-news.html?p=2 | HTTP 403 — browser saw “Just a moment...” |
| protektor.co.uk | https://protektor.co.uk/blog/ | HTTP 403 — browser saw “Robot Challenge Screen” |
| ritherdon.co.uk | https://ritherdon.co.uk/news-page/ | bot-check page — browser saw “Robot Challenge Screen” |
| rsdpressings.co.uk | https://rsdpressings.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| sqfabs.ie | https://www.sqfabs.ie/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| staffordshirefabrications.co.uk | https://staffordshirefabrications.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| stephensgaskets.co.uk | https://www.stephensgaskets.co.uk/category/news | bot-check page — browser saw “Robot Challenge Screen” |
| t-drill.co.uk | https://t-drill.co.uk/blog/ | bot-check page — browser saw “Robot Challenge Screen” |
| tadweld.co.uk | https://tadweld.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| tauntonfab.co.uk | https://www.tauntonfab.co.uk/news.html | bot-check page — browser saw “Robot Challenge Screen” |
| thehexgroup.co.uk | https://www.thehexgroup.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| thinklaser.com | https://thinklaser.com/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| tinsleybridge.co.uk | https://www.tinsleybridge.co.uk/about/latest/ | bot-check page — browser saw “Robot Challenge Screen” |
| torus-group.com | https://www.torus-group.com/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| tubebendform.co.uk | https://tubebendform.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| universalwolf.com | https://universalwolf.com/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| upmanlaser.co.uk | https://upmanlaser.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| whitecrossring.co.uk | https://whitecrossring.co.uk/news/ | bot-check page — browser saw “Robot Challenge Screen” |
| wickens.co.uk | https://www.wickens.co.uk/news | bot-check page — browser saw “Robot Challenge Screen” |
| wilmat.co.uk | https://www.wilmat.co.uk/classic-blog/ | bot-check page — browser saw “Robot Challenge Screen” |
| wiltonengineering.co.uk | https://www.wiltonengineering.co.uk/news-updates/ | bot-check page — browser saw “Robot Challenge Screen” |
| woodplc.com | https://www.woodplc.com/news?collection=wood~sp-push-data&query=!nullsearch&start_rank=1&sort=date | HTTP 403 — browser saw “Just a moment...” |
| xometry.eu | https://xometry.eu/en/blog/ | HTTP 403 — browser saw “Error 403 Forbidden” |

### News page gone (404) — the address needs updating (21)

| Site | Address | Detail |
|---|---|---|
| admpressings.co.uk | https://admpressings.co.uk/news/ | HTTP 404 |
| bowson.co.uk | https://www.bowson.co.uk/blog.html | HTTP 404 — homepage suggests https://www.bowson.co.uk/blog |
| celsheetmetal.com | https://www.celsheetmetal.com/category/news | HTTP 404 |
| dawsonme.com | https://www.dawsonme.com/insights | HTTP 404 |
| fabricast.co.uk | https://www.fabricast.co.uk/news.php | HTTP 404 — homepage suggests https://fabricast.co.uk/news.html |
| firmac.co.uk | https://www.firmac.co.uk/news | HTTP 404 |
| formrite-sheetmetal.com | https://formrite-sheetmetal.com/latest-news/ | HTTP 404 |
| francisbrown.co.uk | https://www.francisbrown.co.uk/media/ | HTTP 404 |
| jhtengineering.co.uk | https://www.jhtengineering.co.uk/news | HTTP 404 |
| kentronixwelding.co.uk | https://www.kentronixwelding.co.uk/news | HTTP 404 |
| lunds.co.uk | https://www.lunds.co.uk/News.html | HTTP 404 — homepage suggests https://www.lunds.co.uk/news/index.html |
| metlase.com | https://www.metlase.com/news-media/ | HTTP 404 — homepage suggests https://www.unipart.com/news/ (a browser read the suggested page) |
| mettisgroup.com | https://www.mettisgroup.com/news/ | HTTP 404 |
| p-and-b.com | https://www.p-and-b.com/about-us/news/ | HTTP 404 |
| pawleandco.co.uk | https://www.pawleandco.co.uk/news | HTTP 404 |
| pentlandmaterialsupply.com | https://pentlandmaterialsupply.com/news | HTTP 404 |
| smarterstrongertogether.com | https://www.smarterstrongertogether.com/case-studies/ | HTTP 404 |
| smarterstrongertogether.com | https://www.smarterstrongertogether.com/news/ | HTTP 404 |
| wearegateway.co.uk | https://www.wearegateway.co.uk/about-us/news-/ | HTTP 404 |
| wfel.com | https://www.wfel.com/news-and-events | HTTP 404 — homepage suggests https://knds.com/en/news-and-media (a browser read the suggested page) |
| wightmanstewart.com | https://wightmanstewart.com/news-updates/ | HTTP 404 |

### Unreachable — DNS, certificate, timeout or server error (23)

| Site | Address | Detail |
|---|---|---|
| aalberts-st-heat.co.uk | https://aalberts-st-heat.co.uk/news | fetch failed (ECONNREFUSED) |
| angloeuropeangroup.co.uk | http://www.angloeuropeangroup.co.uk/ | fetch failed (ENOTFOUND) |
| angloeuropeangroup.co.uk | http://www.angloeuropeangroup.co.uk/#pr_blog | fetch failed (ENOTFOUND) |
| caldwellmetalwork.co.uk | https://caldwellmetalwork.co.uk/latest-news-and-blogs/ | fetch failed (ECONNRESET) |
| f3sheetmetal.com | https://f3sheetmetal.com/category/news/ | fetch failed (ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE) |
| gateway-chassis.co.uk | https://gateway-chassis.co.uk/news/ | fetch failed (ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR) |
| gwhfabs.co.uk | https://www.gwhfabs.co.uk/blog/ | fetch failed (ERR_TLS_CERT_ALTNAME_INVALID) |
| hsm.aero | https://hsm.aero/hsm-news/ | fetch failed (UND_ERR_CONNECT_TIMEOUT) |
| ingeniumintegration.com | https://ingeniumintegration.com/news/ | fetch failed (UND_ERR_CONNECT_TIMEOUT) |
| libertysteelgroup.com | https://libertysteelgroup.com/news/ | fetch failed (UND_ERR_SOCKET) |
| mazakeu.co.uk | https://www.mazakeu.co.uk/news-events/company-news/ | fetch failed (CERT_HAS_EXPIRED) |
| midascladding.com | https://midascladding.com/news/ | fetch failed (UND_ERR_CONNECT_TIMEOUT) |
| midfabdevelopments.co.uk | https://www.midfabdevelopments.co.uk/news | fetch failed (UND_ERR_CONNECT_TIMEOUT) |
| mie-solutions.co.uk | https://mie-solutions.co.uk/news/ | fetch failed (ENOTFOUND) |
| millmg.co.uk | https://www.millmg.co.uk/blog/ | fetch failed (ERR_TLS_CERT_ALTNAME_INVALID) |
| pneuform.com | https://pneuform.com/news/ | fetch failed (CERT_HAS_EXPIRED) |
| pressworkexpertise.com | https://pressworkexpertise.com/ | fetch failed (CERT_HAS_EXPIRED) |
| pressworkexpertise.com | https://pressworkexpertise.com/#ourblog | fetch failed (CERT_HAS_EXPIRED) |
| seyi.com | https://www.seyi.com/latest-news.htm | HTTP 500 Internal Server Error |
| source-engineering.co.uk | https://www.source-engineering.co.uk/news.php | fetch failed (ENOTFOUND) |
| steeleson.co.uk | https://steeleson.co.uk/news/ | fetch failed (UND_ERR_CONNECT_TIMEOUT) |
| thomas-storey.co.uk | https://thomas-storey.co.uk/news/ | fetch failed (CERT_HAS_EXPIRED) |
| titanmanufacturing.co.uk | https://titanmanufacturing.co.uk/titan-news/ | fetch failed (ENOTFOUND) |

### Built with JavaScript — only a real browser can read it (12)

| Site | Address | Detail |
|---|---|---|
| ajwells.co.uk | https://ajwells.co.uk/news/ | readable only in a real browser (JavaScript-built page) |
| bpfabs.co.uk | https://bpfabs.co.uk/news/ | readable only in a real browser (JavaScript-built page) |
| bpfabs.co.uk | https://www.bpfabs.co.uk/news/ | readable only in a real browser (JavaScript-built page) |
| forgedsolutionsgroup.com | https://www.forgedsolutionsgroup.com/news/ | readable only in a real browser (JavaScript-built page) |
| katmex.co.uk | https://www.katmex.co.uk/news/ | readable only in a real browser (JavaScript-built page) |
| kerfdevelopments.com | https://kerfdevelopments.com/category/blog/ | readable only in a real browser (JavaScript-built page) |
| kerfdevelopments.com | https://kerfdevelopments.com/category/case-studies/ | readable only in a real browser (JavaScript-built page) |
| lesjoforsab.com | https://www.lesjoforsab.com/about-lesjofors/news/ | readable only in a real browser (JavaScript-built page) |
| mrindustrialservices.co.uk | https://mrindustrialservices.co.uk/blog/ | readable only in a real browser (JavaScript-built page) |
| nukonlasers.co.uk | https://nukonlasers.co.uk/news/ | readable only in a real browser (JavaScript-built page) |
| press.bystronic.com | https://press.bystronic.com/en/?culture=en | readable only in a real browser (JavaScript-built page) |
| worldofesf.com | https://www.worldofesf.com/news | readable only in a real browser (JavaScript-built page) |

### Nothing readable found (19)

| Site | Address | Detail |
|---|---|---|
| albertjaggerengineering.co.uk | https://www.albertjaggerengineering.co.uk/news-and-media | page loads but no feed, API, sitemap or article links (browser: also empty) |
| amada.eu | https://www.amada.eu/uk-en/company/amada-uk/amada-united-kingdom/case-studies/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| amada.eu | https://www.amada.eu/uk-en/more/news/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| apsmith.co.uk | https://www.apsmith.co.uk/news-and-media | page loads but no feed, API, sitemap or article links (browser: also empty) |
| baesystems.com | https://www.baesystems.com/en/newsroom | page loads but no feed, API, sitemap or article links (browser: also empty) |
| caunton.co.uk | http://www.caunton.co.uk/news.aspx | page loads but no feed, API, sitemap or article links (browser: also empty) |
| clevedon-fasteners.co.uk | https://www.clevedon-fasteners.co.uk/news | page loads but no feed, API, sitemap or article links (browser: also empty) |
| erconengineering.co.uk | https://www.erconengineering.co.uk/blog/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| fablink.co.uk | https://www.fablink.co.uk/about-us/news | page loads but no feed, API, sitemap or article links (browser: also empty) |
| fladder.dk | https://www.fladder.dk/en/news | page loads but no feed, API, sitemap or article links (browser: also empty) |
| flowwaterjet.com | https://www.flowwaterjet.com/about/news-events/press-releases | page loads but no feed, API, sitemap or article links (browser: also empty) |
| gestamp.com | https://www.gestamp.com/Media | page loads but no feed, API, sitemap or article links (browser: also empty) |
| greenfoldsystems.co.uk | https://greenfoldsystems.co.uk/news/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| grouprhodes.co.uk | https://www.grouprhodes.co.uk/news | page loads but no feed, API, sitemap or article links (browser: also empty) |
| mcgeoch.co.uk | https://mcgeoch.co.uk/news/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| mti.uk.com | https://mti.uk.com/news/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| rdp-metalwork-group.co.uk | https://www.rdp-metalwork-group.co.uk/news-cramlington | page loads but no feed, API, sitemap or article links (browser: also empty) |
| shermaynes.co.uk | https://shermaynes.co.uk/news/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
| tpsm.co.uk | https://tpsm.co.uk/ | page loads but no feed, API, sitemap or article links (browser: also empty) |
