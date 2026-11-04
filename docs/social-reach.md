# Social reach: what we can count, and how

This note backs the "Social media reach" figure on the grid homepage's stats band with real options. Today that figure is a hardcoded `347_000` copied from the design comp (`src/components/grid-home/cards.tsx:508-521`).

**Checked 4 Nov 2026.** For [issue #4](https://github.com/luizafontanab/smi-app/issues/4) (formerly GAPS D5 / HUMAN-TODO 4.3).

**Decided 4 Nov 2026 (Luiza):** none of the ranked options below as written. An admin types the homepage figure and its label into a console page. That page shows per-platform followers (fetched for Facebook, Instagram and YouTube where credentials exist, typed in otherwise), typed-in views, and newsletter subscribers (read-only) as guidance. Spec: the agent brief on #4. YouTube's terms (III.E.4.b and III.E.4.h, under YouTube below) limit how its subscriber count is stored and combined.

**Jas's steer.** Big follower counts are "a bit of a sales gimmick". He wants "a sensible number of followers … achieved through good content" (`../requirements/DESIGN-QUOTES.md:1056-1059`). So a smaller figure we can defend beats a large one we can't.

**SMI's accounts** (`src/lib/social.ts:93-101`): LinkedIn `company/sheet-metal-industries`, X `@SMIUK_`, Facebook `SMIUK`, Instagram `sheetmetalindustries`, YouTube channel `UCwg7Css79gc_adlmO3_fVxA`, TikTok `@smiuk_`. I did not research TikTok.

---

## Summary

| Platform | Followers automatable? | Impressions/reach automatable? | Approval needed | Cost | Token upkeep | Verdict |
|---|---|---|---|---|---|---|
| **Buffer** (existing integration) | **No.** No follower field on `Channel`. | Partly: per-post metrics and `aggregatedPostMetrics`. Buffer's help centre calls them experimental. | None; owner creates a personal API key | Included in every plan, Free too | API key, no stated expiry | Don't use for this figure |
| **Facebook Page** | **Yes.** `followers_count` on the Page node | Yes (`page_media_view`, `page_total_media_view_unique`), but the metric set keeps changing | **None** if only Page admins use the app (Standard Access) | Free | Long-lived Page token, **no fixed expiry** | Good to automate |
| **Instagram** (business) | **Yes.** `followers_count` on IG User | Yes (`reach`, `views`) | **None** for an account we own (Standard Access) | Free | 60-day token. Refreshable by code, but expires for good if a refresh is missed | Good to automate, with a refresh job |
| **LinkedIn Page** | Yes. `networkSizes` → `firstDegreeSize` | Yes (`organizationalEntityShareStatistics`), 12-month window | **Yes.** Community Management API vetting, then a screencast review for Standard tier | Free | 60-day access token. 365-day refresh token, then **a person must re-authorise every year** | Possible but heavy. Terms unclear for public display |
| **X** | Yes. `public_metrics.followers_count` | Per post only (`impression_count`). No account-level total found | Developer account plus a payment card | Pay-per-use: **$0.010 per user read** (about $3.65 a year for one daily read) | App bearer token. Lifetime not verified | Cheap, but needs a paid account |
| **YouTube** | Yes. `statistics.subscriberCount`, rounded down to 3 significant figures | Views via the Analytics API (OAuth). No general impressions metric found | None | Free (1 quota unit per call, 10,000 a day) | Plain API key for public statistics (see Not verified) | Easiest to automate. Must refresh at least every 30 days |

---

## Buffer

- **Followers: no.** Buffer's API reference lists the 27 fields on `Channel`. None is a follower, audience or statistics field. The nearest is `postingGoal`, which counts posts, not people. ([reference](https://developers.buffer.com/reference.html#channels))
- **Analytics: partly, with conflicting status.**
  - The developer docs document per-post `metrics` (`impressions`, `reach`, `views`, `reactions`, and others) and an `aggregatedPostMetrics(organizationId, startDateTime, endDateTime, channelIds?, tags?)` query. The query's range is capped at 365 days. Metrics are ingested about daily. "A missing metric does not mean zero". In a mixed-network aggregate, a metric is dropped unless every channel supports it. Post metrics need a personal API key. ([post metrics guide](https://developers.buffer.com/guides/post-metrics.html))
  - Buffer's help centre says: "We don't currently offer your analytics or insights data through the API." It calls post metrics an "early, experimental set" and adds: "we don't recommend relying on it for reporting or production tools." ([help article](https://support.buffer.com/articles/using-buffers-api-GtIYIQilz5))
  - The REST migration guide also points analytics users to the dashboard. ([migration guide](https://developers.buffer.com/guides/rest-migration.md))
- **Why a summed "reach" is misleading.** Summing per-post `reach` counts the same person once per post. It is not "people reached".
- **Auth:** a personal API key, which only an organisation **owner** can create. API access comes with every plan, including Free. ([help article](https://support.buffer.com/articles/using-buffers-api-GtIYIQilz5); `.env.example:73-82`)
- **Limits:** Free plan allows 150 requests per 15 minutes, 600 per 24 hours, and 1,000 per channel per 30 days (3,000 maximum). All keys share these limits. ([API limits](https://developers.buffer.com/guides/api-limits.html))
- **Status in our setup:** no Buffer key exists yet (HUMAN-TODO 1.16), so none of this has been tried against a live schema.
- **Verdict:** Buffer can't supply a follower count. Its post metrics are labelled experimental and would give a summed, double-counted figure. That is exactly the kind of number Jas distrusts.

## Facebook Page

- **Followers:** `GET /{page-id}?fields=followers_count` returns "Number of page followers". On New Page Experience Pages, `fan_count` returns the same value. ([Page reference](https://developers.facebook.com/docs/graph-api/reference/page/))
  - Reading our own Page's data needs a Page access token with `pages_read_engagement` (plus `pages_show_list`).
  - Page Public Content Access (PPCA) is only needed for **other people's** Pages. (same page)
- **Approval:** if only people with a role on our Meta app use it, permissions "will only need Standard Access", with no App Review. Advanced Access needs App Review and Business Verification. ([access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/))
- **Token upkeep:** a long-lived Page token, made from a long-lived (60-day) user token, has "no expiration date". It can still be invalidated "under certain conditions". That page doesn't list them; Meta's token-debugging docs cover it. ([long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/))
- **Impressions/reach:**
  - Page Insights (`read_insights` + `pages_read_engagement`, ANALYZE task) offers `page_media_view` and `page_total_media_view_unique` (day / week / days_28). ([insights reference](https://developers.facebook.com/docs/graph-api/reference/insights/))
  - Limits: only the last 2 years of data; at most 90 days per query; the Page needs at least 100 likes.
- **Deprecations:**
  - `impressions` and "page fans" metrics were deprecated on 15 Nov 2025, with `impressions` replaced by `views`. ([Meta blog, 15 Aug 2025](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/))
  - The insights reference says "a number of the Page Insights metrics" were deprecated for all versions by 15 June 2026, and `page_impressions_unique` is deprecated above v25.
  - Secondary sources (e.g. [Coupler.io](https://docs.coupler.io/sources/category/social-media/facebook-page-insights/data-overview/meta-facebook-insights-deprecated-metrics-june-2026), [Supermetrics](https://docs.supermetrics.com/docs/facebook-insights-field-changes-june-30-2026-1)) say `page_impressions_unique` is replaced by `page_total_media_view_unique`. I could not open Meta's own list of deprecated metrics, so treat that mapping as **not verified**.
  - In practice, the reach metric set has changed twice in a year. A homepage figure built on it would need maintenance.
- **Rate limit:** Page tokens fall under Business Use Case limits of 4,800 × engaged users per 24 hours. That is ample for one call a day. ([rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))
- **Terms:**
  - Meta Platform Terms (last updated 3 Feb 2026) have no clause specifically about displaying metrics or caching them.
  - Data may only be processed for the purposes Meta's docs allow (§3.a.viii) and as our privacy policy describes (§4.c).
  - Aggregated or derived data still counts as Platform Data (§12.l). ([Platform Terms](https://developers.facebook.com/terms/dfc_platform_terms/))
  - Showing our own follower count on our own site looks fine, but that is my reading, not a ruling.

## Instagram (business account)

- **Followers:** the `followers_count` field on the IG User is a public field: "Total number of Instagram users following the user." ([IG User reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/))
  - Through Instagram Login (`graph.instagram.com`) it needs `instagram_business_basic`.
  - Through Facebook Login it needs `instagram_basic` + `pages_read_engagement`.
- **Approval:** Standard Access is enough "for accounts you own or manage and have added to your app". Advanced Access (App Review) is only needed for accounts we don't own. ([Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login))
- **Token upkeep (Instagram Login):** the long-lived token lasts 60 days.
  - `GET graph.instagram.com/refresh_access_token` extends it by another 60 days, once the token is at least 24 hours old.
  - "Tokens that have not been refreshed in 60 days will expire and can no longer be refreshed." (same page)
  - So a scheduled refresh job keeps it alive with no human involved. If the job fails for 60 days, someone has to log in again.
  - Via Facebook Login, the Page token route above may avoid this. See Not verified.
- **Impressions/reach:** `GET /{ig-user-id}/insights` gives `reach` (day; `total_value` or `time_series`) and `views`. ([IG insights](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/insights/))
  - Needs `instagram_business_manage_insights` (Instagram Login) or `instagram_manage_insights` (Facebook Login).
  - Data can be up to 48 hours late. The `follower_count` *metric* (not the field) needs 100+ followers.
  - `impressions` was removed from all versions on 21 Apr 2025, replaced by `views`.
- **Rate limit:** 4,800 × impressions per 24 hours. ([rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/))
- **Terms:** same Meta Platform Terms as Facebook.

## LinkedIn Page

- **Followers:** `GET https://api.linkedin.com/rest/networkSizes/urn:li:organization:{id}?edgeType=COMPANY_FOLLOWED_BY_MEMBER` returns `{ "firstDegreeSize": n }`. This is the number of followers "for any organization". ([Organization Lookup](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api))
  - `organizationalEntityFollowerStatistics` "no longer returns `totalFollowerCounts`". It gives demographic breakdowns, or daily, weekly or monthly *gains* for the last 12 months. ([Follower Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/follower-statistics))
- **Impressions:** `organizationalEntityShareStatistics` returns `impressionCount` and `uniqueImpressionsCount`. These are organic only, over a rolling 12-month window, by DAY or MONTH. ([Share Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics))
  - `organizationPageStatistics` gives Page views. ([Page Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/page-statistics))
  - Both need `rw_organization_admin`, with the authorising member an ADMINISTRATOR of the Page.
- **Approval (the big cost):** all of this sits in the **Community Management API**, a "Vetted Product with development and standard tiers". ([CM overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview))
  - Development tier is open only to "registered legal organizations for commercial use cases". It requires a verified business email, verified organisation and website, and the app verified by a Page super admin.
  - Standard tier also needs a full integration, a privacy policy, test credentials and a narrated screencast of each use case.
  - A rejection means starting again with a new app. ([App Review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review))
  - Development tier's default limits are 500 requests per app and 100 per member. The period isn't stated (see Not verified). A daily fetch fits easily.
- **Token upkeep:** access tokens last 60 days and refresh tokens 365 days. Refreshing does **not** extend the refresh token, so "the member must reauthorize your application when refresh tokens expire": **a person, once a year**. ([refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens))
- **Version upkeep:** the API is versioned monthly, and old versions are retired. For example, version 202511 is sunset on 16 Nov 2026. (Deprecation banner on every page above.)
- **Terms:**
  - The Marketing API Terms (last revised 25 Jul 2025) say Analytics Data may only be used or made available "to provide reporting" to Authorized Clients (§3.1(a)).
  - They also say we "must not store or cache any Marketing Data" except as the docs allow (§4.1). ([Marketing API Terms](https://www.linkedin.com/legal/l/marketing-api-terms))
  - The storage rules allow "Organization Pages' Admin and Reporting Data (e.g. number of followers …)" to be kept for **one year**. ([data storage](https://learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements))
  - **Whether showing our own follower count to the public counts as "reporting" is unclear.** I would not rely on it without LinkedIn's answer.

## X

- **Followers:** `GET https://api.x.com/2/users/by/username/SMIUK_?user.fields=public_metrics` returns `public_metrics.followers_count`. App-only bearer token auth is accepted. ([user lookup](https://docs.x.com/x-api/users/user-lookup-by-username))
- **Cost:** pay-per-usage credits with no subscription. "User: Read" costs **$0.010 per resource**. There is no free tier, only a $20 promotional credit after the first purchase. ([pricing](https://docs.x.com/x-api/getting-started/pricing))
  - One read a day is about $3.65 a year, but it needs a funded developer account with a card on file.
  - Secondary sources say pay-per-use became the default on 6 Feb 2026 ([e.g.](https://opentweet.io/how-to/x-api-pay-per-use-explained)). I did not confirm that date on x.com.
- **Impressions:** `public_metrics.impression_count` is **per post**. Organic and non-public metrics need user-context auth and are "only available for posts created within the last 30 days". No account-level impressions endpoint is documented. ([metrics](https://docs.x.com/x-api/fundamentals/metrics))
- **Rate limits:** not stated on the lookup page. Not verified.
- **Terms:**
  - The Developer Policy says stored X Content must be kept up to date and deleted or changed within 24 hours of an X request.
  - It also forbids using the API to "Calculate aggregate X metrics" or "aggregate X Post metrics, such as … the number of account engagements". ([Developer Agreement & Policy](https://docs.x.com/developer-terms/agreement-and-policy))
  - Showing our own follower count probably isn't "aggregate X metrics" (those examples are platform-wide). But a summed impressions figure for our account could arguably fall under it. Treat as **not verified**.

## YouTube

- **Subscribers:** `GET https://www.googleapis.com/youtube/v3/channels?part=statistics&id=UCwg7Css79gc_adlmO3_fVxA` returns `statistics.subscriberCount`. ([channels resource](https://developers.google.com/youtube/v3/docs/channels))
  - The count is "rounded down to three significant figures".
  - `hiddenSubscriberCount` says whether the count is public.
  - `viewCount` is lifetime views. From 24 Aug 2026 it also counts autoplay and hover starts.
- **Cost:** `channels.list` costs 1 unit against a default quota of 10,000 units a day. ([quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)) Free.
- **Impressions/reach:** the YouTube Analytics API (OAuth, `yt-analytics.readonly`, channel owner) gives `views` and `subscribersGained`/`subscribersLost`. I found no general impressions metric in the part of the page I read; the page was truncated. ([channel reports](https://developers.google.com/youtube/analytics/channel_reports))
- **Terms (Developer Policies):**
  - We "must not store the subscriber count … for more than 30 days" without owner authorisation (III.E.4.b).
  - We must show "the most updated API Data available" (III.E.4.f).
  - We must not replace it with our own calculated figure (III.E.4.h).
  - We must link to YouTube's Terms of Service (III.A.1).
  - In practice: refresh at least daily, and show the number exactly as returned. ([policies](https://developers.google.com/youtube/terms/developer-policies))

---

## Figures we already count

All three are real counts from our own database. They need no approvals and no tokens.

| Figure | Where it comes from | What it means | Caveats |
|---|---|---|---|
| **Newsletter subscribers** | `contacts` where `subscribed = true`, `unsubscribed_at is null`, `bounced_at is null`. Already computed as `subscriberCount()` (`src/app/console/actions.ts:2316-2319`) | People who currently get SMI Monthly | Includes contacts added because "your business is in contact with Sheet Metal Industries" (`src/lib/newsletter-footer.ts:21`), not only website sign-ups. The `contacts` table is a local mirror of Bigin (`supabase/migrations/20260808000002_commerce.sql:106-121`), so it is only as current as the last sync. |
| **Recipients per issue** | `newsletter_issues.sent_count`, written at send time from the provider's recipient count (`src/lib/jobs.ts:947`). Also `approved_recipients`, the audience at approval (`20261020000005_newsletter_approval.sql:31`) | How many inboxes the latest issue went to | Null until an issue is actually sent through Resend. Opens and clicks exist (`opens_count`, `clicks_count`) but opens are unreliable in general. I did not check how ours are attributed. |
| **Site visitors** | `count(distinct session_hash)` from `analytics_events`. The console's "site users" figure already does this over 12 months (`site_sessions_last_year()`, `supabase/migrations/20260811000001_site_sessions.sql`; `src/app/console/page.tsx:106`). A monthly version would be a new query. | Distinct browsers (IP + user agent) that accepted analytics cookies | **Consent-only**, so it undercounts: only an explicit "all" is recorded (`src/lib/analytics.ts:46-56`). `consent_stats` records the daily accept rate (`20260901000011_consent_stats.sql`), so the size of the undercount is known. Scaling up by that rate would be an *estimate*, which `analytics.ts:7` rules out ("Numbers must be REAL — no inflation"). `consent_stats.total_requests` counts requests, not people. On page routes it isn't bot-filtered: `isObviousBot` is only used in `/go` and `/visit`. One person on two devices counts twice. See `docs/GDPR.md` §7 for why it stays consent-gated. |

---

## Options to bring to Jas

Ranked by honesty first, then by how little upkeep each needs. Every option replaces the invented 347,000.

### 1. Show newsletter subscribers instead (recommended to ship now)
- **Homepage says:** "2,140 · Newsletter subscribers" (example number), or relabel the card "Reach the trade: newsletter readers".
- **Updates:** automatically, from `contacts`, on every page render or cached daily.
- **Setup:** about an hour. The query already exists (`subscriberCount`).
- **Upkeep:** none.
- **Why first:** it's real and ours, and it measures people who *chose* to hear from SMI, which fits Jas's "good content" stance. It can go live while options 2–3 are decided.

### 2. Total followers, entered by hand monthly
- **Homepage says:** "5,800 · Followers across LinkedIn, Facebook, Instagram, X and YouTube" (example number), with "as of October 2026" in small print.
- **Updates:** a staff member types each platform's follower count into a small console form once a month. The page shows the sum and the date.
- **Setup:** small: one settings row plus a form.
- **Upkeep:** about 5 minutes a month. If it goes stale, the date shows it, which keeps the figure honest.
- **Why:** it covers LinkedIn, probably SMI's largest B2B audience, with no LinkedIn vetting, no yearly re-authorisation and no terms question.

### 3. Total followers, partly automatic
- **Homepage says:** same as option 2.
- **Updates:**
  - A daily job fetches Facebook `followers_count`, Instagram `followers_count` and YouTube `subscriberCount`.
  - LinkedIn and X stay hand-entered, as in option 2. X can be automated for about $4 a year if Jas wants it.
- **Setup:** moderate:
  - a Meta developer app (Standard Access, no review) and a long-lived Page token;
  - an Instagram token refresh job if we use Instagram Login;
  - a Google Cloud API key;
  - a cron job and a cache table.
- **Upkeep:** low. Re-issue the Meta token if it's invalidated. Watch the YouTube 30-day rule; a daily job already meets it. The hand-entered LinkedIn and X figures still need about 5 minutes a month.
- **Why third:** more moving parts for the same number option 2 gives, and LinkedIn is still manual.

### 4. Full automation including LinkedIn (not recommended now)
- **Homepage says:** same total, refreshed daily.
- **Setup:** heavy:
  - Community Management API vetting (registered legal entity, verified business email and website, Page super admin verification);
  - building the OAuth flow;
  - for Standard tier, a narrated screencast review.
- **Upkeep:** a Page admin must re-authorise **every year** (refresh tokens expire after 365 days). We would also follow LinkedIn's monthly API versions.
- **Open risk:** the Marketing API Terms limit Analytics Data to "reporting" for authorised clients. Public display on our homepage may not qualify (not verified).
- **Why last:** the highest cost and upkeep for one number, and a terms question we can't settle ourselves.

**Not recommended in any form: impressions or "reach" totals.**
- Every platform's impressions count repeat views. Summing across posts or platforms counts the same person many times.
- Meta has renamed or removed these metrics twice since 2024.
- X's policy discourages aggregate engagement metrics.
- A six-figure "reach" number is exactly what Jas called a sales gimmick.

---

## Not verified

1. **Buffer post metrics status:** the developer docs present them plainly; the help centre calls them experimental and not for reporting. I also didn't confirm whether Buffer counts posts made outside Buffer. Settle it with a live key (HUMAN-TODO 1.16) and an introspection query, or by asking Buffer support.
2. **Meta's exact list of Page Insights metrics deprecated by 15 June 2026,** and that `page_total_media_view_unique` replaces `page_impressions_unique`. Only secondary sources confirmed the mapping. Settle it on Meta's changelog or deprecated-metrics page.
3. **What invalidates a "non-expiring" Meta Page token.** The page I read doesn't list the conditions. Check Meta's access-token debugging docs.
4. **Whether a Facebook Page token can read the linked Instagram account's `followers_count`.** That would avoid the 60-day Instagram token. The docs I read list a User token for that route. Settle it with a test call.
5. **The `networkSizes` permission.** The Organization Lookup page lists `rw_organization_admin` for the API as a whole and says the follower count works "for any organization", but doesn't name a scope for that call. Settle it after Development-tier approval.
6. **LinkedIn Development-tier limits** (500 per app, 100 per member): the time window isn't stated.
7. **LinkedIn terms:** whether showing our own Page's follower count on our public homepage counts as "reporting" under Marketing API Terms §3.1(a). Ask LinkedIn developer support.
8. **X:** rate limits for user lookup, how long the app-only bearer token lasts, and the 6 Feb 2026 pay-per-use date (secondary sources only). Also whether one account's summed impressions would count as "aggregate X Post metrics".
9. **YouTube:** whether a plain API key is enough for `part=statistics`. The docs don't mark these fields owner-only, so it is very likely, but untested. Also whether the Analytics API has an impressions metric; the page was truncated.
10. **TikTok:** we link it (`src/lib/social.ts:100`), but I did not research its API.
11. **Our own counts:** I didn't run any query, so I don't know today's subscriber, recipient or visitor numbers. I also didn't check whether `contacts` includes non-UK or test addresses, or whether `analytics_events` has a retention purge that would shorten a 12-month visitor count.
