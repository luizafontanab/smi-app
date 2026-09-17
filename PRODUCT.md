# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Visitors** — readers in the UK sheet metal, fabrication and welding trade, arriving mostly from social links and search to read stories, watch videos, find suppliers in the member directory (list + map), and check events.
- **Members** — paying **companies** (£40/month, one shared login per company), typically equipment suppliers and service providers. They maintain a company page, submit news/videos/events (approval-gated), view stats, and buy visibility (adverts, featured slots).
- **Admin** — **Jas**, the owner-operator, runs the entire publication from the Console (Command Centre, approvals, CMS, advert inventory, CRM, newsletter). Staff sub-roles (super-admin / approver / viewer / input-only) are in the requirements but not built; code has exactly two roles: `admin` and `member` (`src/lib/db/types.ts`).

## Product Purpose

Custom rebuild of sheetmetalindustries.com — public site, member area (`/dashboard`), operator console (`/console`), advert engine, and platform layer — replacing the incumbent WordPress site and agency.

Success means two things (confirmed): the rebuild **fully replaces WordPress at parity or better** with zero dependency on the incumbent agency, and **Jas can run the whole publication from the Console in less time, with no spreadsheets**.

## Positioning

**Owner-curated trust.** Every story is approved by Jas before it publishes; advertising is rotation-neutral (position is never for sale); there is no affiliate or commission revenue; the mailing list is never sold and unsubscribes stick. Neutrality and curation are the product — a claim a listings aggregator or ad-driven trade site could not truthfully copy.

## Operating Context

- Revenue: £40/month memberships + advertising (banners, featured slots, newsletter slots, bundles at £450–500/month, homepage takeovers).
- Jas operates day-to-day from the Console; "Needs You Today" surfaces approvals and expiries. Members log in occasionally; visitors are the volume audience.
- Authoritative requirements: `../requirements/USE-CASES.md` (70 use cases: V1–V18 visitor, M1–M14 member, A1–A29 admin, S1–S8 automatic). Phase 1 = public site, member area, admin area, advert engine + needed platform; "Content OS" (module 6) is severable.
- Standing audits: `docs/GAPS.md` (numbered gap list vs use cases), `docs/HUMAN-TODO.md` (human-only steps: Resend/DNS, Stripe, Bigin, deliverability, brand assets, decisions).
- External adapters (Resend, Stripe, Bigin/Zoho, Buffer, MaxMind) degrade to logging stubs until accounts/keys exist.

## Capabilities and Constraints

Implemented: editorial CMS (stories/videos/events, scheduling, kanban), member directory with Leaflet map, newsletter issues via Resend with permanent unsubscribe, advert inventory (spots, bundles, artwork desktop+mobile, takeovers, impression/click tracking), membership lifecycle (comp/grace/lapsed), Stripe £40/mo subscriptions + PDF invoices, promo codes, CRM push, social push, analytics rollups, media library, block-based page layouts, cookie consent, Postgres job queue on Vercel Cron.

Hard constraints (quoted from requirements): "nothing publishes without Jas's approval · rotational-neutral advertising, position is never for sale · no affiliate/commission revenue · list never sold, unsubscribes stick · nothing may look tool-built · tidy, don't overhaul · zero dependency on the incumbent agency · no per-seat licensing · no spreadsheets."

Terminology: **members** are companies, never people; **stories**, never "posts"; membership types (Equipment Supplier, Service Provider, IT Services, Software, Training and Education); adverts/bookings/slots/artwork/placements/bundles/takeover; Featured Member; Featured Machine; **Console** (admin) vs **Dashboard** (member area); Command Centre; "Needs You Today"; rotation neutrality; grace period/lapsed; Content OS; MACH.

Explicitly undecided (do not invent): rotation semantics (HUMAN-TODO 5.4), lapsed-member backlink policy (5.5), final brand assets (5.6), GAPS open decisions D1–D4, which of the three orange values is canonical.

## Brand Commitments

- Name: **Sheet Metal Industries**; domain sheetmetalindustries.com; voice: plainspoken UK trade ("UK sheet metal, fabrication & welding news").
- The current identity is **provisional** pending real brand assets from Jas (HUMAN-TODO 5.6) — future work must not treat it as final.
- Brand orange `#fe5000` (Pantone Orange 021) is the incumbent accent (a three-orange ambiguity is an open decision); usable only as a non-text/large-text accent (3.3:1).
- **Fonts are open to change** (confirmed Sep 2026): League Spartan + Allerta Stencil are working choices, and **readability improvement is an explicit goal** of any type change.
- **The supplied logo must be used in the nav bar** (confirmed Sep 2026). Only raster JPGs exist: `/Users/zafontana/SMI/SMI logo 500 x 500 Deep orange.jpg`, `SMI logo 500x 250 deep orange.jpg`, `smi_logo_all_orange.jpg`. No vector artwork — do not fabricate one; derive web-ready assets from these files.

## Evidence on Hand

- Real WordPress extract at `/Users/zafontana/SMI/handover-extract/json/`: 1,992 stories, 123 members, 390 videos, 69 equipment suppliers, 53 events, 21 pages, taxonomy, attachments index. Seeded by `scripts/seed-real.ts` (local cap: 150 newest stories); synthetic data via `scripts/seed.ts`.
- Source documents in `/Users/zafontana/SMI/`: REQUIREMENTS.md, meeting transcripts (Aug 2026), proposal/, design/, `SMI phase 1 Luiza.pdf`.
- Does NOT exist — never fabricate: vector logo artwork, real newsletter back-issues, advert dimension specs for formats B/C/D/F, rate-card pricing beyond £40/mo and £450–500 bundles, brand-pack resources, live Resend/Stripe/Bigin/MaxMind accounts.

## Product Principles

1. Nothing publishes without Jas's approval — the approval gate is identity, not friction.
2. Neutrality is the product: rotation-neutral adverts, no affiliate revenue, the list is never sold.
3. Nothing may look tool-built; tidy, don't overhaul.
4. Every workflow must be runnable by one owner-operator from the Console — no spreadsheets, no agency, no per-seat licensing.
5. Readability first: the trade reader's comprehension outranks stylistic flourish.

## Accessibility & Inclusion

WCAG 2.x A/AA is enforced in CI: the axe e2e suite (`tests/e2e/a11y.spec.ts`) fails the build on serious/critical violations across the public pages. Maintain the documented contrast ratios in `globals.css`, the skip link, and focus-visible rings. Brand orange stays accent-only (3.3:1 — not body-text safe). English-only (en_GB), £ currency; no i18n planned.
