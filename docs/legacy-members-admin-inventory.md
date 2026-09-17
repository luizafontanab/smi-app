# Legacy members-admin inventory

Feature-and-data inventory of the legacy site's members-only dashboard
(`sheetmetalindustries.com/members-admin/`), built for feature-parity planning
against `GAPS.md` (see especially Part A4, "Member area") and
`../requirements/USE-CASES.md` ("Member" actor). This file does not modify
either of those documents.

**Method:** read the legacy WordPress theme source and DB dump at
`/Users/zafontana/SMI/SMI Handover/` (outside this repo), then confirmed live
behaviour by logging into the production site with a real dev account
(`rish@25terawatts.com`, a "25 Tera Watts" test membership) via a disposable,
read-only Playwright script — no form was submitted beyond the login itself,
and no data was changed. All 22 currently-linked routes returned `200`, and
the 3 routes flagged in source as coded-but-unwired returned `404`, matching
the source analysis exactly. Screenshots and raw DOM dumps from that pass
live outside the repo (session scratchpad) and are not included here since
they contain another company's live account data.

## Sources

| Source | What it gave us |
|---|---|
| `SMI Handover/website theme/SMI-Website-main/web/app/themes/Sprout/` | Authoritative implementation: routes, permissions, AJAX handlers, JS behaviour, field registry |
| `SMI Handover/database/*.sql` | WordPress schema — confirms membership is custom-built on `wp_posts`/`wp_postmeta` (ACF), no membership/CRM plugin tables |
| `handover-extract/json/*.json` | Pre-normalized "resolved" shape of member/story/event/video data |
| `2026-08-05-Sheet-Metal-Industries-dev-pack-v2/` | Business context: current commercials, explicit scope boundaries for the new build |
| Live Playwright pass (this task) | Confirms which routes/forms are actually reachable today, and resolves 3 ambiguities noted below |

## Permission / role model

Access is a single numeric field per user (`classes/Best/User.php::adminAreaRoutes()`),
and every members-admin route has an explicit allow-list of these codes:

| Code | Role | Notes |
|---|---|---|
| 0 | Unverified | Can only see Account → Declaration until verified |
| 1 | Mentee | Narrowest access |
| 2 | Independent | Full individual member |
| 3 | Corporate Member | Seat on a corporate account, no admin rights |
| 4 | Corporate Admin | Can manage News, sees Statistics |
| 5 | Corporate Owner | Full billing/seat control |
| negative of any of the above | Same role, but membership inactive | Mostly routed to Billing/re-subscribe |

Live-confirmed: on `account/company-details`, the `sector` radio group is
rendered `disabled` in the DOM — matches the source finding that sector
becomes locked after initial registration.

## Per-section inventory

Status column: **Live** = confirmed 200 + expected content this pass. **Live, orphaned control** = page loads but a documented backend capability has no UI to trigger it. **Absent (404)** = coded in source but not wired into routing.

| Section | Status | Roles | What it does | Data fields |
|---|---|---|---|---|
| Dashboard | Live | all | Landing tiles (Statistics, Add Location, Edit Profile, View Live Page, Resources) + lifetime page-view counter and two summary charts | `page_views`, `member.is_active`, `user.postcode` |
| Statistics | Live | 2, 4, 5 | Page-performance chart (views vs. clicks, 12mo), clicks-by-channel chart (website/social/phone/email, 6mo), views-only and clicks-only monthly charts | Stats letter-codes: `v`=view, `w`=website click, `p`=phone, `e`=email, `f/t/i/y/l/c`=Facebook/Twitter/Instagram/YouTube/LinkedIn/TikTok, bucketed by `MMYY` |
| Account → Personal Details | Live | all | Edit own name/email/phone; syncs Stripe customer email (owners) and MailChimp merge fields | `first_name`, `last_name`, `user_email`, `phone_number` |
| Account → Company Details | Live (sector locked) | 2, 4, 5 | Edit company registration data + Sector/Specialties taxonomy | `company_name`, `postcode`, `address_one`, `address_two`, `city`, `county`, `sector` (radio, **disabled post-registration**, confirmed live), `specialties[]` (checkboxes, ≤6 per source validation) |
| Account → Declaration | Live | 0 (unverified only) | One-time compliance checklist gating verification | `dbs`, `qualified`, `code_of_conduct`, `cpd_requirements` (all required checkboxes) |
| Account → Billing & Membership | Live, orphaned control | -5,-2,-1,1,2,5 | Stripe-backed billing: view cost/renewal date, add/remove/default payment method, view invoice history + PDF download, toggle auto-renewal, resubscribe when inactive | `stripe_customer`, `stripe_subscription`, `billing_status`, `renewal_timestamp`, `auto_renewal`, `payment_methods[]`, `invoices[]`. **Confirmed live**: only "Add Payment Method" and "Disable Auto-Renew" forms are present — the seat-count/proration-preview UI (`get_update_members_cost` AJAX + change-qty form) that the backend fully supports has no current front-end trigger. |
| Member → Profile | Live | 2, 4, 5 | Bio text + theme colour for the public microsite; Publish/Preview | `post_content`, `colour` |
| Member → Map | Live | 2, 4, 5 | Google Places autocomplete + draggable pin for the public directory map location (separate from the admin postcode) | `map[name]`, `map[lat]`, `map[lng]`, `map[address]` (confirmed as hidden inputs live) |
| Member → Media | Live | 2, 4, 5 | Logo (required) and banner image upload, YouTube video URL | `logo`, `thumbnail`, `video` |
| Member → Social Media | Live | 2, 4, 5 | Company social links | `facebook`, `twitter`, `instagram`, `youtube`, `linkedin`, `tiktok` |
| Member → Contact Details | Live | 2, 4, 5 | Public contact info — these three double as outbound-click stat categories (`w`/`p`/`e`) | `website`, `phone_number`, `email` |
| Member → Testimonials | Live | 2, 4, 5 | Up to 5 quote/author pairs shown on the public profile | `quotes[]` (text, author) |
| Advertising (7 tabs) | Live | all | Lead-gen only — informational copy + an embedded Contact Form 7 enquiry form per ad product; no self-service purchase | Tabs: General Enquiry, Banner Adverts, Banner Design, Featured Member, E-Newsletter, Homepage Takeover, Supplier Logo |
| News → Article Archive | Live | 4, 5 | List of the member's own News/Article posts with status badges (Published/Draft/In Moderation) | — |
| News → New/Edit Article | Live | 4, 5 | Cover image upload, title, restricted-toolbar WYSIWYG body; Save as Draft or Publish (goes to admin moderation) | `title`, `article-form` (body), `file` (cover image). Confirmed live: form posts back to the archive with `edit-id`, ownership-checked server-side. |
| Resources | Live | 1, 2, 3, 4, 5 (broadest of any section) | Downloadable brand/resource-pack cards (logos, brand assets) | Sourced from an ACF options repeater, not member-owned data |
| Notifications (header widget, not a route) | Live | all | Bell icon + unread badge; dropdown of comment/review/payment/new-user/article-approved/article-blocked events; click marks read | ACF repeater on the member: `content`, `link`, `type`, `time_stamp`, `admins_only` |
| Onboarding / Help popup | Live | all | First-login welcome modal, re-triggerable via a help icon; content differs for owners vs. non-owners | — |
| Logout | Live | all | Standard WP logout redirecting to `/members-login/` | — |
| Member Register (seat management) | **Absent (404, confirmed live)** | would be -5,-4,4,5 | Fully coded: view/add/edit/delete team seats up to the paid seat count, invite flow, role assignment (Admin/Member) | `first_name`, `last_name`, `user_email`, `role` |
| Reviews (member-side moderation) | **Absent (404, confirmed live)** | would be 4, 5 | Fully coded: view/respond to reviews left on the member's own listing | — |
| Events (member-side admin) | **Absent (404, confirmed live)** | — | Partially coded, its own registration is commented out even in source (never fully wired) | — |

## Data model appendix

- **Member record** (resolved shape from `handover-extract/json/members.json`):
  `wp_id, slug, title, status, date_gmt, company_name, phone_number, email, website, registration_number, year_established, address{line_1,line_2,town_city,county,postcode}, lat, lng, map{name,lat,lng,address}, colour, social{...}, logo{...}, hero{...}, video_url, quotes[], services[], sector[], registration_status, registration_step, active, completed_registration, start_date, body_raw, body_html, blocks`
- **Taxonomies**: `best-service` ("Specialisms", ≤6), `best-level` ("Sector"), `best-service-delivery`, `event-type`, `video_tag`.
- **Stats schema**: single-letter keys (`v/w/p/e/f/t/i/y/l/c`) bucketed by month (`MMYY`), stored as post meta on the member CPT.
- **Billing fields** (all `wp_postmeta` on the member CPT): `stripe_customer`, `stripe_subscription`, `billing_status`, `renewal_timestamp`, `auto_renewal`, `annual_agreement_end`, `active`, `completed_registration`, `registration_status`, `registration_step`, `number_of_members`, `active_members`, `free_members`.
- **Member scoring**: a weighted "find a member" ranking score (membership level, tenure, profile completeness, distance to searcher, featured-ad status) — powers directory ordering, not member-admin itself, but explains why Advertising's "Featured Member" product exists.
- **Reference table**: `wp_uk_towns` (postcode/town gazetteer) backs the address/map autocomplete.

## Integrations

| Integration | Role | Notes from dev-pack |
|---|---|---|
| Stripe | Subscriptions, invoices, payment methods | **Stays** as the processor for the new build |
| MailChimp | Newsletter + tag sync on profile save | Dev-pack flags this for replacement (Klaviyo candidate) |
| Google Maps/Places | Address autocomplete + directory map pin | GB-restricted autocomplete |
| Geo Query (WP plugin) | Proximity search/scoring for the public "Find a Member" directory | Not member-admin itself, but consumes Member → Map data |
| Bigin/Zoho CRM | ~2,000 companies/2,700 contacts, syncs to MailChimp | Outside members-admin; noted for completeness per dev-pack |

## Decisions (resolved 31 Aug 2026)

1. **Multi-seat/per-member pricing — out of scope.** One membership type, one flat price. The legacy seat-based tiered pricing (`number_of_members`, per-seat Stripe proration) is **not** carried forward.
2. **Member Register, Reviews (member-side), Events (member-side admin) — deprecated, not in scope for now.** Matches their already-disabled state in production.
3. **No seat management — one login per member.** Not "seat cost" scoping, but a structural simplification: each member org gets a single login, not a multi-user team with roles (Admin/Member/Owner). This also removes the need for #1's proration and #2's Member Register entirely, rather than just deferring them.
4. **Sector field — do not lock.** The legacy behaviour (disabled after registration) is not replicated; members can edit their sector at any time.
