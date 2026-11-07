---
name: Sheet Metal Industries
description: UK sheet metal, fabrication & welding news — public site, member area, operator console
colors:
  hot-cut-orange: "#ff8200"
  hot-cut-orange-text: "#ac5800"
  furnace-gold: "#f7a600"
  ink: "#111418"
  graphite: "#5a6068"
  paper: "#ffffff"
  chrome: "#0b0d10"
  chrome-hover: "#22262c"
  line: "#e4e6e9"
  shade: "#f4f5f6"
  danger: "#b91c1c"
  success: "#147538"
typography:
  display:
    fontFamily: "League Spartan, Arial, sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 3rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "League Spartan, Arial, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "League Spartan, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  reading:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  label-micro:
    fontFamily: "Source Sans 3, Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    letterSpacing: "0.14em"
  logo:
    fontFamily: "Allerta Stencil, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    letterSpacing: "-0.025em"
rounded:
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.hot-cut-orange}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1rem"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
  card-console:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "1.25rem"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
---

# Design System: Sheet Metal Industries

**Scope (Classic branch).** This document describes **Current**, the design on `staging`. On the `classic` branch the public site wears **Classic** (spec #68), which follows SMI's existing website on purpose. It sets aside three rules here: The One Accent Rule (it adds `--classic-blue` #3100ff for links and buttons and `--classic-red` #e3141e for decorative icon discs), "Don't add gradients" (the join banner's placeholder gradient, until its photo arrives; docs/HUMAN-TODO.md 7.5), and "League Spartan speaks, Source Sans 3 reads" (Classic sets everything in League Spartan). Classic's colours live in `src/components/classic/palette.ts` and `classic.css`, with their WCAG AA pairs tested there. The console and member area are Current on both branches, and every other rule here still applies to Classic.

## Overview

**Creative North Star: "Cut Steel, Clean Paper"**

The system is the laser-cut identity of the trade it serves: crisp forms and hot-metal orange applied sparingly to white paper, with the precision of the cut — not the noise of the shop — as the visual metaphor. Pages are plainspoken and trustworthy, the voice of a trade insider rather than a marketing department; edges are industrial and precise, with exact spacing and engineering-bred type doing the work decoration would otherwise fake. Orange carries the identity; the greys carry the page.

Density follows the surface. Public pages read like a well-set trade front page: confident League Spartan headlines over calm white cards on near-white paper, led (in the default "forge" design) by a cinematic near-black hero stage. The operator console and member dashboard are quieter still — flat white cards, hairline borders, and tabular figures, because the person using them is running a business, not browsing.

Two looks are deliberately rejected. No **generic SaaS gloss**: gradient meshes, glassmorphism, purple-blue palettes, rounded-everything friendliness — nothing may look tool-built. And no **off-the-shelf magazine-theme clutter**: the cramped widgets, sidebar noise, and stock typography of the WordPress site this product replaces. (Note: the identity is provisional pending the client's final brand assets — see PRODUCT.md Brand Commitments — so honor these tokens as the current authority, not as final artwork.)

**Key Characteristics:**
- One accent (Hot-Cut Orange) over a disciplined neutral field of ink, graphite, chrome, and paper
- Two type voices: League Spartan speaks, Source Sans 3 reads
- Flat white surfaces on near-white ground; depth only as a response to state
- Trade-paper density on public pages; operational calm in the console and dashboard
- Two structural design variants (forge / grid) sharing every token

## Colors

A single industrial accent over a neutral scale — orange is the identity, the greys are the page.

### Primary
- **Hot-Cut Orange** (#ff8200): the glow of metal at the cut line, matched to the supplied logo artwork so the mark and the accent read as one. Carries the brand: the wordmark's "Industries", CTA fills (with ink text), focus rings, active indicators, the hero eyebrow tick. At 2.5:1 on paper it is strictly a non-text accent there; on ink/chrome surfaces (7.4:1) it may set small text.
- **Hot-Cut Orange (text)** (#ac5800): the same hue deepened until 12px text passes AA on paper (5.1:1). Used for small uppercase labels, statuses, and eyebrows on light surfaces.
- **Furnace Gold** (#f7a600): the lighter gradient stop of the supplied artwork. Reserve for small text that must sit on ink (9.2:1) and for the rare warm accent beside the orange.

### Neutral
- **Ink** (#111418): body text, headings, dark CTA fills, and the newsletter header band.
- **Graphite** (#5a6068): secondary text, metadata, in-body link color, and the Featured Machine's frame.
- **Paper** (#ffffff): card surfaces. The page ground behind cards is near-white; white cards + hairline separation define the surface model.
- **Chrome** (#0b0d10): the site header/footer band and hero stage ground. **Chrome Hover** (#22262c) is its hover state.
- **Line** (#e4e6e9): hairline borders and dividers.
- **Shade** (#f4f5f6): the tint panel between paper and line — quiet grouped regions and inert placeholders.

### Semantic
- **Danger** (#b91c1c, 6.3:1 on paper) and **Success** (#147538, 5.8:1 on paper, 5.0:1 on its own `/10` tint): status meaning only — rejections, errors, live/approved states. Tint their grounds via opacity (`bg-danger/10`), never a separate hex, and never use either decoratively.

### Named Rules
**The Cut-Line Rule.** Hot-Cut Orange never sets body-size text on light ground. Small labels on paper use #ac5800; small text on ink/chrome may use full #ff8200; ink-on-orange (7.4:1) is the CTA pairing — white-on-orange fails AA at any size. The contrast table in `src/app/globals.css` is the measured authority.

**The One Accent Rule.** Orange (with its gold companion) is the only expressive hue. Danger and Success exist strictly as status semantics, never as decoration. No new hues without a rebrand.

## Typography

**Display Font:** League Spartan (variable, with Arial-metric fallback)
**Body Font:** Source Sans 3 (variable, normal + italic, with Arial-metric fallback)
**Logo Font:** Allerta Stencil (wordmark only — never as a display face)

**Character:** A geometric industrial voice over a plainspoken workhorse: League Spartan's tight, stencil-adjacent forms give headlines their machined confidence, while Source Sans 3's open apertures and large x-height keep long trade copy, UI labels, and data unambiguous (I/l/1 distinct, real tabular figures).

### Hierarchy
- **Display** (800, clamp(1.75rem–3rem), 1.15, −0.02em): the hero stage title only; balanced wrapping, max 22ch, clamped to 3 lines.
- **Headline** (700, 1.875rem/text-3xl, tight): article titles; 1.5rem (text-2xl) for section-page and profile H1s.
- **Title** (700, 1rem–1.125rem): card and panel headings; in the console, an H2 with a 4×14px orange tick bar.
- **Body** (400, 1rem, 1.5): UI and card text; **Body small** (0.875rem) is the dense UI step — controls, nav, card metadata rows. **Reading** (400, 1.0625rem, 1.6, ≤68ch via `.story-read`): public long-form prose — articles and static pages.
- **Label** (600–700, 0.75rem, +0.05–0.16em tracking, uppercase) with **Label micro** (0.6875rem) for eyebrows, rail labels, and hero metadata. 10px (0.625rem) is the absolute floor, used once on the hero-rail card eyebrow.

### Named Rules
**The Speaks-vs-Reads Rule.** League Spartan speaks (h1–h3 route through `--smi-font-heading`); Source Sans 3 reads (everything else through `--smi-font-sans`). Never set paragraphs in Spartan or headlines in Source Sans; never use Allerta Stencil beyond the wordmark.

**The Tabular Rule.** Stats, calendars, and money set `tabular-nums` — Source Sans 3 carries real `tnum`, and the console depends on columns that align.

## Layout

Centered max-width containers on near-white ground: `max-w-6xl` (public pages), `max-w-5xl` (dashboard, console content), `max-w-4xl` (articles), `max-w-3xl` (newsletter issues), with `px-4` page gutters. Cards are the unit of composition — white, hairline-separated, on a 0.25rem-based rhythm (internal padding p-3 → p-6 by density; gaps of 1–1.5rem). Grouping is tight inside cards, generous between sections.

Two structural design variants share every token and diverge only in composition, switched by the `smi-theme` cookie (`data-theme` / `data-design` attributes): **forge** (default) leads with a full-bleed chrome hero stage (min-height `min(84vh, 48rem)`) with a hover-promoted card rail; **grid** pulls the page up with a shorter stage (`min(60vh, 34rem)`) and denser multi-column packing. New surfaces must render correctly under both.

Breakpoints are Tailwind defaults (640/768/1024/1280); the header collapses to a drawer below `lg`, card grids step down from 3–4 columns to 1.

## Elevation & Depth

**The Flat-By-Default Rule.** Surfaces are flat paper. The soft resting shadow (`shadow-sm`) exists only to separate a white card from the near-white ground; depth beyond that appears strictly as a response to state — hover raises a card to `shadow-md`, and the hero's active rail card earns the system's one dramatic shadow. Never decorate a resting surface with a larger shadow, and never use zero-offset halos.

### Shadow Vocabulary
- **Resting card** (`shadow-sm`): the default and near-universal surface shadow.
- **Hover lift** (`shadow-md`, with `transition`): interactive cards on hover.
- **Active hero card** (`box-shadow: 0 18px 34px -12px rgb(0 0 0 / 0.7)` with `translate3d(0,-10px,0) scale(1.045)`): the promoted card in the hero rail — the only theatrical shadow in the system.

## Shapes

Machined, small-radius geometry: controls and chips sit at 0.25rem (`rounded`), public cards at 0.5rem (`rounded-lg`), console/dashboard panels at 0.75rem (`rounded-xl`), pills and badges at full radius. Borders are hairlines (`--smi-line`, or `border-black/5` on console cards); the two sanctioned emphatic borders are the **2px Hot-Cut Orange frame** on Featured Member cards and the **2px graphite frame** on the Featured Machine card, each paired with a small corner tag (solid fill, 11px bold uppercase, 0.25rem radius). No other decorated borders — no thick colored side-bars on cards or callouts.

## Components

Refined and restrained: hairlines and whitespace over fills and borders, controls that state their job and recede. Solid fills are reserved for the few true CTAs.

### Buttons
- **Shape:** small radius (0.25rem); padding ~0.5rem 1rem; weight 600–700, text-sm.
- **Primary (brand):** Hot-Cut Orange fill with ink text (`bg-brand text-ink font-semibold`), hover `brightness-110`. Used for Become a Member, Subscribe, Search.
- **Dark:** ink or chrome fill with white text — the workhorse action (Website, Send, form submits).
- **Quiet/outline:** white with hairline border (`border px-4 py-2`) for secondary actions (Call, Essential only).
- **Hero CTA:** the one pill (9999px): white fill, black text, play-glyph pairing, hover `translateY(-1px)` + slight dim.
- **Focus (all):** global `:focus-visible` ring — 2px Hot-Cut Orange outline, 2px offset (3px/3px on hero cards).

### Cards / Containers
- **Public content card:** white, `rounded-lg`, `shadow-sm`, internal p-3–p-5; hover `shadow-md` when the whole card links. Media regions bleed to the card edge (`overflow-hidden`), 16/10 or fixed-height covers.
- **Console/dashboard panel:** white, `rounded-xl`, `border border-black/5`, `shadow-sm`, p-4–p-5 (`Card` in `src/components/console/ui.tsx`).
- **Featured cards:** the corner-tag pattern (see Shapes).
- **Dark band:** chrome/ink full-width section with white text and centered brand CTA (join band, newsletter issue header).

### Inputs / Fields
- **Style:** white fill, hairline border, 0.25rem radius, `px-3 py-2`, text-sm–base; placeholders gray-500 (4.6:1).
- **Focus:** the global orange `:focus-visible` ring; the TipTap editor uses an inset ink outline instead.
- **Error:** message text beside the field; forms keep the reader's place (no modal interruptions).

### Navigation
- **Header:** chrome band, hairline bottom border; Allerta Stencil wordmark with orange "Industries"; links text-sm white, `rounded px-3 py-2`, hover `bg-chrome-hover`; signed-in state is a brand-filled chip. Below `lg` everything moves into the drawer (`MobileNav`).
- **Industries strip:** slim chrome band above the header (`IndustryBar`) — text-xs `text-white/70` links to `/industry/[slug]`, hover `bg-chrome-hover` + white; single-row horizontal scroll on small screens (never wraps); `aria-label="Industries"` to keep the second nav landmark named.
- **Console nav:** dark band with section links; active section carries an orange underline/edge and `aria-current`.

### Hero Stage (signature)
The forge homepage's full-bleed chrome stage: crossfading cover layers (520ms, easeOutQuint `cubic-bezier(0.22,1,0.36,1)` for movement, soft ease for opacity) under a fixed near-black scrim; staggered copy entrances (60ms steps); a 26s Ken Burns drift on the active cover; and the hover-promoted card rail (opacity field dims to 0.42, active card lifts with the system's one big shadow and a 3px orange wipe-in indicator). All motion collapses to 150ms opacity-only under `prefers-reduced-motion`. This grammar belongs to the hero; do not export its drama to operational surfaces.

## Do's and Don'ts

### Do:
- **Do** route every family through its token: `--smi-font-heading` (League Spartan) for h1–h3, `--smi-font-sans` (Source Sans 3) for everything else, `--smi-font-logo` strictly for the wordmark.
- **Do** keep public long-form prose in `.story-read` — 1.0625rem/1.6 at ≤68ch, centered, with in-body adverts keeping the container's full width.
- **Do** use `text-brand-text` (#ac5800) for small labels on light surfaces, and `tabular-nums` on every stat, price, and calendar figure.
- **Do** theme the browser's own surfaces: the orange `::selection` (30% mix on paper, ink text), the 2px offset focus ring, `text-underline-offset: 0.15em` on prose links.
- **Do** verify both design variants (forge and grid) when touching shared components — they share every token and diverge only structurally.

### Don't:
- **Don't** set small text in #ff8200 on white — 2.5:1 fails AA; the deepened #ac5800 exists for exactly this.
- **Don't** add gradients, glass, backdrop blur, or new hues — the anti-references (SaaS gloss, magazine-theme clutter) are confirmed rejections, and orange is the only voice.
- **Don't** put more than `shadow-sm` on a resting surface; depth is a state response (Flat-By-Default).
- **Don't** use Allerta Stencil outside the wordmark, or League Spartan for paragraphs.
- **Don't** add thick colored side-borders to cards or callouts; the only emphatic frames are the two sanctioned 2px featured-card frames with corner tags.
- **Don't** restyle `.story-body`'s editor usage — reading refinements live on `.story-read`, so the TipTap editing surface stays full-width.
