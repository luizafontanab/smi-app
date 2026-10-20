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
- **The user agent is honest:** `SMI-story-sources/1.0 (+<site url>)`. Sites
  that block automated requests are left blocked, never worked around.

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
