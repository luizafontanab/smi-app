# The live site's visual language (sheetmetalindustries.com)

Research for ticket #58, part of map #57 (the **Classic** design option).
Captured 2026-11-06 from the live WordPress site. Every claim comes from the
site's own HTML and CSS, or from a headless-Chromium render of it, unless
labelled otherwise.

**Sources**

- `https://sheetmetalindustries.com/` and the pages listed under "Page inventory" (raw HTML via `curl`, rendered via Playwright/Chromium)
- `…/app/themes/Sprout/dist/css/main.css?ver=6.5.5` (135 KB, minified): the theme stylesheet. Cited below as **main.css**
- `…/app/themes/Sprout/dist/css/modules.css?ver=6.5.5` (22 KB): events, reviews, the advert carousel. Cited as **modules.css**
- `…/app/themes/Sprout/dist/images/logo-wide.svg`, `logo.svg`, `logo-inverted.svg`
- `https://fonts.googleapis.com/css2?family=League+Spartan:wght@400;500&display=swap`
- `google/fonts` repo: `ofl/leaguespartan/METADATA.pb` and `OFL.txt` (licence)
- Screenshots: [`live-site-screenshots/`](live-site-screenshots/). Each page has a desktop shot (1440 px wide) and a phone shot (390 px wide, iPhone UA). All are full-page JPEGs taken after accepting the cookie modal.

The theme is a custom agency build called **"Sprout"** by Formation Media (footer credit: "Website by Formation Media"). It is WordPress, with Contact Form 7, Swiper, Magnific Popup, the GDPR Cookie Compliance plugin and a Mailchimp embed.

---

## 1. Colour palette

The palette is small and saturated: **black chrome, a light-grey canvas, white cards, orange accents and an electric blue for every link and button**. There are no CSS custom properties in the theme. All values are hard-coded hex. The stylesheet references `var(--primary)`, `var(--secondary)`, `var(--body)` and `var(--cta)` but never defines them, so those declarations do nothing (see §9).

Occurrence counts are from main.css plus modules.css.

| Role | Hex | Count | Where (selector evidence) |
|---|---|---|---|
| **Accent orange** (brand) | `#ff8200` | 83 | 4 px top border of the top bar (`.grey-bg` computed `border-top: 4px solid rgb(255,130,0)`); list markers `ol li::marker, ul li::marker {color:#ff8200}`; hover for primary buttons `.btn-primary:hover {background:#ff8200}`; footer link hover; table header bg; `#become-member {background-color:#ff8200}`; `.hot-news .number` rank badges; round icon discs on title bars (`.blog .title-bar .icon`); featured-member card border and label; event detail icons |
| **Electric blue** (primary action/link) | `#3100ff` | 74 | `a {color:#3100ff}`; `.btn-primary {background:#3100ff;color:#fff}`; `em` inside headings `h1 em … {color:#3100ff}`; `::selection {background:#3100ff}`; checked checkbox; search submit; news-card arrow chip `.fake-btn`; pagination squares |
| Blue, hover | `#1d0099` | 1 | `a:hover {color:#1d0099}` |
| **Black** (chrome, text) | `#000` | 69 | `header#site-header {background:#000}`; `footer#site-footer {background:#000}`; `body {color:#000}`; `html {background-color:#000}` |
| **White** (cards, button text) | `#fff` | 144 | Content panels (`.latest-news .container`, `.posts-archive .container`, `.member-card`, `.single-event #page-content` all `background:#fff`); "Back to top" strip |
| **Canvas grey** | `#e2e2e2` | 15 | `body {background-color:#e2e2e2}`; nav-drop dividers; `figcaption` border |
| Canvas chevron stripes | `#dbdbdb` | inline SVG | `.bg-stripes` inline `<svg>` with `.cls-1{fill:#dbdbdb}`: large diagonal chevrons behind the top of each page |
| Top-bar grey | `#555` | 19 | `.grey-bg` computed `background-color: rgb(85,85,85)`; phone mega-menu panel `#mega-menu .wrapper {background-color:#555}`; `figcaption` text |
| Muted text | `#a5a5a5` | 30 | Card meta (date, author, read-time) `.news-card .content .date {color:#a5a5a5}`; footer text and links `footer#site-footer {color:#a5a5a5}`; "ADVERTISEMENT" label; placeholders |
| Nav link grey | `#b4b4b4` | 13 | `.navbar .nav-link {color:#b4b4b4}` (white when current); `.lozenge {background:#b4b4b4}` service tags |
| Light grey | `#f2f2f2` | 19 | Search drop-down panel; member-card logo divider |
| Table/divider grey | `#d5d5d5` | 10 | Table cells; secondary menu text on phone |
| Dark text | `#313131` | 7 | Table body text; input helper text |
| Danger red | `#e70e17` | 10 | `.btn-danger`; skip link background `.skippy {background-color:#e70e17}` |
| Form states | `#dc3545`, `#3a923f`, `#ffc107` | 6/6/3 | CF7 invalid / sent / warning (Bootstrap-derived values) |
| Cookie plugin orange | `#f39224` | plugin inline CSS | GDPR plugin button colour. **Not** the brand orange; it is slightly off. |
| Shadow | `rgba(0,0,0,.05)` | 12 | `box-shadow:0 5px 25px rgba(0,0,0,.05)` on cards and inputs |
| Hero gradient | `rgba(59,59,59,.78) → transparent` | 2 | `.hot-news .big-tile .content {background:linear-gradient(to top,rgba(59,59,59,.78),rgba(0,0,0,0))}` |

**Per-member brand colour.** Member profile pages inject an inline `<style>` that recolours the page with the member's own colour. For Bystronic it is `#ff1100`: `.video-container, #main-content, body { background-color: #ff1100 }`, with the same colour on icons, the stripes and `.member-name`. The whole profile canvas therefore turns that member's colour (see `member-profile-desktop.jpg`). The advertising page also sells a "Homepage Takeover" that changes the section colour scheme of the homepage, news and videos.

**Logo.** `logo-wide.svg` (desktop, includes the tagline "Cut, Shape, Form and Join") and `logo.svg` (phone, stacked) are an orange mark `#ff8200` with a white `#fff` wordmark, made for the black header. `logo-inverted.svg` is orange-only. Our repo already has `public/logo-wide.svg`; I did not diff it against theirs.

**Comparison with ours.** Our `--smi-brand` is already `#ff8200` (`src/app/globals.css`). The colour Classic would add is the **electric blue `#3100ff`** for links and buttons, which our system doesn't use at all. The grey canvas `#e2e2e2` with white panels is also a different surface model from our white paper `#ffffff`.

## 2. Typography

- **One family, League Spartan, for everything**: headings, body, buttons and inputs. main.css has `body {font-family:"League Spartan",sans-serif}` and the same family on `h1…h6`, `.btn` and `pre`. There is no second face.
- **Served from Google Fonts** (`<link href="https://fonts.googleapis.com/css2?family=League+Spartan:wght@400;500&display=swap">`, preconnected to `fonts.gstatic.com`). Only **weights 400 and 500** are requested. `strong {font-weight:500}`, so bold in body copy is only medium.
- **Licence: SIL Open Font License 1.1.** Copyright 2020 The League Spartan Project Authors; designers Matt Bailey and Tyler Finck. It is a variable font, `wght` 100–900 (google/fonts `METADATA.pb`, `OFL.txt`). We already self-host it through `next/font/google` in `src/app/layout.tsx`, so licensing is not an issue.
- **Weights**: 400 throughout. h4 is 500 (`.h4,h4 {…;font-weight:500}`). Headings are **never bold**, which gives the site its light, airy look.
- **Case**: news headlines are typed in uppercase in the CMS, not via `text-transform` (`.hot-news … h4` has no transform). Author lines and the hot-news `.author` use `text-transform:uppercase`.
- **Scale**: fluid below 1200 px, fixed at or above 1200 px (Bootstrap-RFS-style `calc()`):

| Element | < 1200 px | ≥ 1200 px | Line-height | Weight |
|---|---|---|---|---|
| body | `calc(1.025rem + .3vw)` | **1.25rem (20 px)** | 1.6 | 400 |
| h1 | `calc(1.225rem + 2.7vw)` | 3.25rem (52 px) | 1.2 | 400 |
| h2 | `calc(1.15rem + 1.8vw)` | 2.5rem (40 px) | 1.2 | 400 |
| h3 | `calc(1.1rem + 1.2vw)` | 2rem (32 px) | 1.2 | 400 |
| h4–h6 | `calc(1.05rem + .6vw)` | 1.5rem (24 px) | 1.2 | 500 (h4) / 400 |
| `.text-large` | `calc(1.0625rem + .75vw)` | 1.625rem | 1.4 | 500 |
| `.wp-block`, `pre`, tables, labels, inputs | `calc(1.0125rem + .15vw)` | 1.125rem (18 px) | — | 400 |
| news-card h3 | `calc(1.0375rem + .45vw)` | 1.375rem (22 px) | — | 400 |
| nav links | 1rem | 1.125rem (18 px) | — | 400 |
| footer | .9375rem (15 px); links 18 px weight 500 | | | |
| card meta (date/read-time) | 1rem | | | 400 |

  The computed values at 1440 px confirm it: body is 20 px / 32 px, h2 is 40 px / 48 px.
- **Body text is large (20 px)**. Our body is Source Sans 3 at about 17 px. Matching the live site means swapping the body face to League Spartan as well. Our `layout.tsx` comment explains why we moved away from that (I/l/1 ambiguity, no tabular figures). That trade-off is a decision for the spec, not something to copy silently.
- Vertical rhythm: `p+p, ul+p …{margin-top:1.5rem}` and `p+h2 … {margin-top:4rem}`.

## 3. Header and navigation

The header has two stacked bars (`home-desktop.jpg`, `nav-dropdown-desktop.jpg`, `header-phone.jpg`, `mega-menu-phone.jpg`).

1. **Top bar** (`div.grey-bg > nav.container.top.navbar`): `#555` background, **4 px `#ff8200` top border**, 49 px tall. It is shown only at ≥ 440 px (`header#site-header {margin-top:49px}` sits inside `@media (min-width:440px)`; it doesn't appear in the 390 px shots). Contents:
   - Left: **"trending" ticker**, a Swiper carousel of recent videos/stories with an orange round icon ("EUROBLECH DAY 1:", "EXCLUSIVE INTERVIEW - BW BROADCAST :").
   - Right: social icons (Facebook, X/Twitter, LinkedIn, YouTube, Instagram, TikTok) at 50 % opacity, 100 % on hover. Then a secondary menu: **Policies · About · Contact**.
2. **Main header** (`header#site-header`): `#000`, **92 px** tall, `position:sticky; top:4px`. Content max-width 1440 px (`.navbar {max-width:1440px}`), wider than the 1200 px content container.
   - Left: logo. `logo-wide.svg` (with tagline) at ≥ 768 px, 422–480 px wide; stacked `logo.svg` at 220 px on phones.
   - Right (≥ 1200 px only, `.navbar .menu {display:flex}`): **Home · Advertising · News · Videos · Members ▾ · Newsletters · Featured Machine · Events ▾ · MACH Publication**. Links are `#b4b4b4`, 18 px, weight 400. The current item is white with a 2 px `#ff8200` underline (`.nav-item.current-menu-item .nav-link {border-color:#ff8200;color:#fff}`).
   - Drop-downs (Members → Members, Become a Member; Events → Events, Golf Challenge) open on **hover/focus** as a white 280 px panel with **20 px radius**, soft shadow, rows of 500-weight black text divided by 2 px `#e2e2e2`, hovering to blue.
   - Then icon buttons: **search** (opens a full-width `#f2f2f2` panel with a dark overlay), **account** (person icon → `/members-login/`), and a **hamburger** that shows below 1200 px.
   - A `small-header` class (`border-top:4px solid #ff8200`, search hidden) exists in CSS. After scrolling 1200 px on desktop the header class stayed `with-banner`, so I could not confirm when `small-header` is applied.
3. **Phone / below 1200 px**: the hamburger opens `#mega-menu`, a full-screen `#555` panel (`height:calc(100vh - 76px)`). It shows the main items at 2rem white, sub-items indented with small orange dot bullets, then Policies/About/Contact and social icons (`mega-menu-phone.jpg`).
4. **Member profile pages use a different, stripped header**: logo plus a "‹ Back to Website" link, no menu (`member-profile-desktop.jpg`; CSS `.back-to-best, .back-to-edit-member`).

## 4. Footer

From `footer#site-footer` (main.css) and the home HTML:

- Before the footer, every page has two full-width bands:
  1. **"Back to Top"**: a white strip with a centred chevron and label (`.back-to-top {background:#fff}`).
  2. **"Become a Member."**: a solid `#ff8200` band (`#become-member`) with a centred white h2 ending in a full stop, one line of copy and a blue "Become a Member" button.
- **Footer**: `#000` background, `#a5a5a5` text, 15 px, 90 px vertical padding at ≥ 1200 px. Top to bottom, all centred:
  1. **"ADVERTISEMENT" leaderboard carousel** (`.abc-car.footer`): a 1280×170 desktop / 370×280 mobile banner with white-ringed prev/next buttons and "01 02 03" numeric pagination.
  2. **"Sign up to our Newsletter"**: an orange h2 and a Mailchimp email input with an attached blue "Subscribe" button (`border-radius:0 5px 5px 0`).
  3. A row of social icons plus **Policies · About · Contact** (links `#a5a5a5`, 500 weight, 18 px, hover orange).
  4. "© 2026 Sheet Metal Industries. All Rights Reserved." and a reCAPTCHA disclaimer.
  5. The "Website by Formation Media" credit logo (lazy-loaded; it renders as a grey blur in the full-page screenshots. That blur is an artefact of the lazyload placeholder `filter:blur(50px)`, not a design element).
- There are no link columns and no address block. The footer is a single centred stack.

## 5. Recurring components

**Page skeleton.** Grey `#e2e2e2` canvas with large diagonal chevron stripes (`#dbdbdb`, inline SVG) behind the top of the page. Content sits in **white rounded panels** (`border-radius:5px`, padding 1rem on phones and 3rem at ≥ 768 px) inside a **1200 px container** (`.container {max-width:1200px;padding:0 1rem}`). Story bodies use a narrower `.container-narrow`. Breakpoints are Bootstrap's: 576, 768, 992 and 1200 px.

**Radius and shadow.** 5 px almost everywhere (38 uses), with circles for icon discs. The only large radii are the nav drop-down (20 px) and the round cookie "Accept" pill (plugin). There is one shadow: `0 5px 25px rgba(0,0,0,.05)`.

**Buttons** (`.btn`, main.css):
- Base: 20 px League Spartan 400, padding `.625rem calc(1.0375rem + .45vw)`, 2 px transparent border, 5 px radius, white text.
- `.btn-primary`: `#3100ff` bg, white text; **hover/focus `#ff8200`**. This blue-to-orange swap is the site's signature interaction.
- `.btn-transparent`: blue outline that fills blue on hover. `.btn-white`: white with an `#e2e2e2` border that turns black on hover. `.btn-secondary`: a blue text link that turns orange on hover. `.btn-danger`: red.
- Pagination: small **blue squares** with white numbers. The current page is orange, there is a "…" orange square, and the next arrow is outlined (`news-list-desktop.jpg`).

**Section title rows.** An orange 34–60 px circle holding a white icon, followed by the h1/h2 (`.blog .title-bar .icon`, `.hot-vids .title-row .icon`): News 📣, Video 🎥, Events, "Latest Videos", "Featured Member News".

**Hot-news block (home "Newsroom").** One large image tile on the left (65 %, min-height 500 px, bottom gradient, uppercase h4, meta row, blue "Read" button) and three stacked "smol-tiles" on the right (white, image 35 % on the left, uppercase title, muted author, blue "Read" link). Each tile has an **orange numbered badge** `#1…#4` (`.hot-news .number`) hanging off its top-left corner.

**News card** (`.news-card`), used in the news grid, "Latest News" and member news:
- Image 175 px tall, cover, 5 px radius, with a **blue 40 px square arrow chip** in the bottom-right corner (`.fake-btn`, `border-radius:5px 0`).
- Uppercase title (h3, 22 px, black) followed by a muted meta stack: 👤 "PUBLISHED BY …" (uppercase), 📅 date and 🕑 "N MIN READ", all `#a5a5a5` at 16 px.
- Variant `.produced-smi`: black content area, white title, an 80 px "Produced by SMI" badge top-right.
- An optional member logo overlay sits on the image (`.member-overlay`).
- Grid: 4 columns at desktop inside a white panel. The news list shows 16 per page, with an advert carousel after row 2.

**Video card** (`.vid-card`): a 16:9 image with a centred white play disc and an orange "Produced by SMI" rosette, then a 20 px title and the same muted meta.

**Member listing** (`/find-a-member/`, `.member-card`):
- Full-width horizontal white card, logo cell on the left (150 px logo, divider), details on the right.
- Contents: name; location with an orange pin, right-aligned; **grey uppercase service "lozenges"** (`.lozenge {background:#b4b4b4}`, white 14–16 px); a 2-line description; a blue "View Member" button bottom-right.
- **Featured members** get a 2 px orange border and an orange "FEATURED MEMBER" tab above the card (`.member-card.featured:before {content:"FEATURED MEMBER"}`).
- Filters: "Member Types" and "Services" selects, a postcode/town search with a blue "Update" button, a **List View / Map View** toggle, an "89 Results" count and "Load More". An advert banner is inserted into the list.

**Member profile** (`/member/<slug>/`):
- The whole canvas is in the member's colour.
- Title area: name, address, logo.
- A light-grey panel holds a hero image and sections with icon headings: Services (lozenges), Location, Member Profile, and social chips.
- Three white CTA tiles: Visit Member Website / Call Member (number shown) / Email Member.
- "Latest News from <Member>" (a news-card row and a "See All … news" button), then "Watch Our Video", then a map block.

**Event listing** (`/event/`):
- Tabs "Upcoming Events | Previous Events", filters "Event Type" and "Month", a results count.
- Events are **grouped under month headings** ("November 2026"). Each card is a horizontal white card with the image on the left, then a bold title, an orange-icon meta row (📅 date range · 🕑 time · 📍 town and postcode), an excerpt and a blue "View Event" button.
- Advert carousels are interleaved between month groups.
- The page has a **photo banner** header with the title over the image.

**Event detail**: title, orange-icon meta and the event logo on the left/right. Then a white panel with a **live countdown** (four dark-grey tiles: DAYS/HRS/MINS/SECS), Event Description, Event Hosts (member mini-cards with "Go To Member"), Location (map), Event Video and Share buttons.

**Advert slots** (the "abc-car" carousel, modules.css):
- A leaderboard carousel labelled **"ADVERTISEMENT"** (`.special-notification`, `#a5a5a5`, uppercase). Desktop and mobile creatives are separate `<picture>` sources: 1280×170 desktop, 370×280 mobile (sizes from the Advertising page).
- Circular outlined prev/next buttons and **numeric "01 02 03" pagination**.
- Appears in the footer on every page, between home sections, inside the news, video and event lists, after the story body, and inside the member directory.
- Plus a **sticky right-edge "Advertise with SMI" pull-out tab** (`.advert-sticky-side`, a 50×40 orange megaphone tab that slides out a 250 px black panel with an orange "View Advertising Packages" button) on most pages.
- **"Suppliers"** logo carousel (`.partners`): white tiles of supplier logos with round prev/next buttons, near the bottom of most pages.
- There are **no sidebars** anywhere. Every page is single-column content plus full-width bands, and adverts are inline bands, not rails.

**Forms**: white inputs, no border, 5 px radius, 52 px tall, soft shadow; labels 18 px black; blue submit that turns orange on hover; custom checkboxes that are blue when checked.

**Density and spacing.** Generous. 20 px body text, 52 px h1, 4rem gaps before headings, big full-width bands (orange CTA about 75 px of padding, footer 90 px). Cards use 1–1.5rem internal padding with 1–2rem gutters. The overall feel is roomy and promotional, not newspaper-dense. Pages are long: 4,000–7,800 px at desktop, 6,000–10,400 px on phones.

## 6. Page inventory

All pages share: top bar, black header, grey striped canvas, Suppliers carousel, Back to Top, orange "Become a Member" band, black footer with advert carousel and newsletter. "Banner" means a full-width photo header with the page title in white over it.

| Page type | Live URL | Screenshots | Notes |
|---|---|---|---|
| Home | `/` | `home-desktop.jpg`, `home-phone.jpg`, `home-*-cookie-modal.jpg` | Newsroom hot-news (#1–#4) → ad → Latest Videos (4-up) → ad → Featured Members carousel → Featured Member News (white panel, 4-up cards) → Suppliers. **No `<h1>`** on the page. |
| News list | `/news/` | `news-list-*` | Title bar with orange icon; Sort By + Topics (36 topics) selects; 4-up cards in a white panel; ad mid-grid; numbered pagination (128 pages). |
| News story | `/<slug>/` (root-level, no `/news/` prefix) | `news-story-*` | "‹ Back to News"; uppercase h1; meta row; hero image; narrow white body panel; source member link in red; topic lozenge; Share (Facebook/Post/LinkedIn); ad; "Latest News" 4-up panel. |
| Member directory | `/find-a-member/` | `member-directory-*` | h1 "Find Member"; filters; List/Map toggle; featured cards first; Load More. |
| Member profile | `/member/<slug>/` | `member-profile-*` | Member-colour canvas; stripped header; see §5. |
| Events list | `/event/` | `events-list-*` | Banner; Upcoming/Previous tabs; month-grouped cards. |
| Event detail | `/event/<slug>/` | `event-detail-*` | Countdown, hosts, map (rendered empty in the headless capture, see §10), video link, share. |
| Videos list | `/video/` | `videos-list-*` | Same template as the news list (Sort By + Topics, 4-up, pagination over 25 pages). |
| Video detail | `/video/<slug>/` | `video-detail-*` | |
| Newsletters | `/newsletters/` | `newsletters-*` | Banner; latest issue feature; **plain list of month links that go to `mailchi.mp`**; "More from this section" black tiles (2024/2023/2022 archives). Shows a **newsletter sign-up modal popup** on load (visible in the desktop shot). |
| Advertising | `/advertising/` | `advertising-*` | Banner; packages A–E, each with a screenshot mock and a blue CTA; spec table; media pack buttons; enquiry form. |
| Contact | `/contact/` | `contact-*` | |
| Become a Member | `/become-a-member/` | `become-a-member-*` | Banner; alternating image/text rows; three-up icon features; "Sign up for Membership" button. |
| Featured Machine | `/31770-2/` (sic) | `featured-machine-*` | Plain page: h1, image, rich text. |
| MACH Publication | `/mach-publication/` | `mach-publication-*` | Static page. |
| About | `/about/` | `about-*` | Static page. |
| Policies | `/policies/` | `policies-*` | Static page. |
| Golf Challenge | `/welcome-to-the-sheet-metal-industries-golf-challenge/` | `golf-challenge-*` | Static/landing page under the Events menu. |
| Search results | `/?s=laser` | `search-*` | h1 "Search results for …". |
| 404 | any unknown path | `not-found-*` | h1 "404". |
| Interaction states | — | `nav-dropdown-desktop.jpg`, `header-phone.jpg`, `mega-menu-phone.jpg`, `header-scrolled-desktop.jpg` | |

The desktop full-page shots are 1509 px wide, not 1440, because the page overflows horizontally by 69 px (`document.documentElement.scrollWidth` = 1509 at a 1440 viewport). The off-canvas advert tab and "View" panel at the right edge cause it. See §9.

## 7. Mapping onto our public routes (`src/app/(public)`)

| Our route | Live counterpart | Fit |
|---|---|---|
| `/` (`page.tsx`, grid home) | `/` | Direct. The live home's blocks (hot-news #1–#4, latest videos, featured members, featured member news, suppliers) map onto our home sections. Exact section parity was not checked. |
| `/news` | `/news/` | Direct. The live site filters by **Topics** (a select), not by industry pages. |
| `/news/[slug]` | `/<slug>/` | Direct (the URL shape differs; the live site puts stories at root). |
| `/member` | `/find-a-member/` | Direct (name differs). The live site has List/Map views and postcode search. |
| `/member/[slug]` | `/member/<slug>/` | Direct, but the live page has **per-member colour theming** and its own minimal header. |
| `/event`, `/event/[slug]` | `/event/`, `/event/<slug>/` | Direct. |
| `/video`, `/video/[slug]` | `/video/`, `/video/<slug>/` | Direct. |
| `/newsletters` | `/newsletters/` | Partial. The live site is a link list out to Mailchimp. |
| `/newsletters/[slug]` | **none** | The live site has no on-site newsletter issue page; issues live on `mailchi.mp`. Classic must invent this one. |
| `/featured-machine` | `/31770-2/` | Direct (plain WP page). |
| `/advertising` | `/advertising/` | Direct. |
| `/contact` | `/contact/` | Direct. |
| `/join`, `/join/account` | `/become-a-member/` (marketing page) | Partial. The live page is marketing copy with a "Sign up for Membership" button. I did not follow the live sign-up flow, so whether it has a multi-step account page like ours is unverified. |
| `/industry/[slug]` | **none** | The live site has no industry landing pages. Its closest analogue is the Topics filter on `/news/` and `/video/`. (`/industry/` on the live site redirects to an unrelated story by WordPress slug-guessing.) |
| `/pages/[slug]` | `/about/`, `/policies/`, `/mach-publication/`, Golf Challenge | Direct for generic CMS pages. |
| `/search` | `/?s=` | Direct. |
| `not-found.tsx` | 404 template | Direct. |
| `[slug]` at `src/app/[slug]` (outside `(public)`) | — | Not checked; outside this ticket's scope. |
| — | `/members-login/` | Ours is `/login` (outside `(public)`). Out of scope for the public restyle. |

## 8. What the restyle would actually change for us (summary for the spec)

1. **Add `#3100ff` electric blue** as the link and primary-button colour, with an **orange hover**. This is the biggest visual departure from Current.
2. **Switch the canvas** to grey `#e2e2e2` with chevron stripes, and put content in white 5 px-radius panels.
3. **Use League Spartan for body text** too (400/500 only, 20 px desktop body). This is a reversal of our deliberate Source Sans 3 choice; it needs a decision.
4. **Two-bar header**: a `#555` top bar with a 4 px orange top border (ticker + social + Policies/About/Contact), then a 92 px black sticky bar with grey nav links and an orange-underlined current item.
5. **Orange "Become a Member." band, white "Back to Top" strip and a black centred footer** (ad carousel, newsletter, socials, legal).
6. **Card vocabulary**: uppercase titles, muted grey meta with icons, a blue arrow chip on the image, orange circle icons on section titles, orange rank badges, grey uppercase lozenges, orange-framed featured cards.
7. **Advert slots as full-width labelled carousels** with numeric pagination, and no sidebars.

## 9. Hard or unwise to copy

Confirmed in the source:

- **Contrast failures** (WCAG 2.x ratios computed from the hex values):
  - White on `#ff8200` is **2.49:1**. It is used for the "Become a Member." heading and copy, the "FEATURED MEMBER" tab, rank badges, table headers and the advert-panel button text. This fails AA at any size. Our own `globals.css` already forbids white-on-brand; black on `#ff8200` (8.45:1) is the fix we already use.
  - `#a5a5a5` meta text on white cards is **2.46:1** and fails, for every date, author and read-time on cards, at 16 px.
  - `#a5a5a5` on the `#e2e2e2` canvas is **1.90:1** (the "ADVERTISEMENT" label sits on the canvas).
  - Passes: blue `#3100ff` on white 8.16:1, white on blue 8.16:1, `#b4b4b4` nav on black 10.13:1, black on `#e2e2e2` 16.2:1.
- **`tabindex="1"` on every nav link.** 24 per page in the header, top bar and mega-menu. This hijacks keyboard tab order.
- **No `:focus-visible` styles anywhere** (0 occurrences), and `outline:0` on several interactive elements (event tabs, share buttons, social buttons).
- **Drop-down markup**: `<ul class="nav-drop">` directly contains `<a>` elements (invalid list markup). Sub-menus open on hover/`:focus` of the `<li>` only.
- **The home page has no `<h1>`.** Most images have empty or missing `alt` (e.g. home: 47 of 54 `<img>` lack a non-empty alt). Many of these are decorative, so that count overstates the real failures. It is still a signal.
- **A broken reduced-motion rule**: `@media(prefers-reduced-motion:reduce){*{animation-duration:NaNs!important;transition-duration:NaNs!important}}`. `NaNs` is invalid CSS, so reduced-motion users get the full animations.
- **Undefined CSS variables**: `var(--primary)`, `var(--secondary)`, `var(--body)`, `var(--cta)` are referenced but never declared. The desktop nav hover underline (`border-color:var(--secondary)`) and `.banner .breadcrumbs a {color:var(--primary)}` silently do nothing.
- **Horizontal overflow on desktop**: page width 1509 px at a 1440 px viewport, caused by the off-canvas advert tab.
- **A full-screen cookie modal** (GDPR plugin, `height:100vh; background rgba(0,0,0,.7)`) blocks the page until "Accept". It uses its own off-brand orange `#f39224`. A **newsletter popup modal** also appears on `/newsletters/`.
- **Per-member full-page brand colours**: any member's colour becomes the body background with white/black text on it. Contrast can't be controlled. The live site's own Advertising page warns that for takeovers "some colours may not be available if colour contrasts are too poor and are not up to WCAG 2.1 AA-class standards", but the profile pages apply the colour unconditionally.
- **Dated patterns**: a carousel for nearly every block (ticker, adverts, featured members, suppliers); an uppercase-typed headline convention; the lazyload blur-up (`filter:blur(50px)`) placeholder; a hover-only mega drop-down; the `/31770-2/` slug.
- **Fluid `calc(rem + vw)` sizes** jump to fixed values at 1200 px. We'd likely use `clamp()` instead; the end values are what matter.

## 10. Not verified

- **When the header switches to `small-header`.** The class exists in CSS, but scrolling 1200 px in headless Chromium did not apply it. It may depend on JS conditions (e.g. scroll direction) or on page type.
- **Event-detail map, member-profile video and map.** They rendered empty in the headless captures. They are probably consent-gated or lazy iframes; I didn't investigate.
- **The live membership sign-up flow** beyond `/become-a-member/`, and any logged-in or member-only views (`/members-login/`). Not visited.
- **Contact, About, Policies, MACH Publication, Golf Challenge, Search and 404 layouts** are only screenshotted. I didn't analyse their markup.
- **The "Homepage Takeover" colour scheme** is known only from the Advertising page's own description; I didn't see a live instance.
- **Whether our `public/logo-wide.svg` is identical** to the live `logo-wide.svg`.
- **Image alt counts** include intentionally empty `alt=""`. I didn't classify which images are decorative.
- **Hover states** were read from CSS. Apart from the nav drop-down, none were observed in a browser.
