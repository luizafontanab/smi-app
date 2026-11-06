/**
 * The design option's hook points (GLOSSARY "Design option"; spec #68, #69).
 *
 * The public site comes in two complete looks, Current and Classic, each built
 * from its own branch: Current from `staging`, Classic from `classic`. The
 * seven pieces below are the only components the two options swap. The public
 * layout and the routes import them from HERE and never from the component
 * file, so `classic` changes this one existing file and nothing else: it points
 * each export at a Classic component in its own folder and imports its
 * stylesheet at the marked spot. A merge from `staging` conflicts only when the
 * list itself changes.
 *
 * On `staging` every export is Current's own component and no stylesheet is
 * imported, so nothing here changes what Current looks like. The type
 * annotations hold a replacement to the same props as the Current component.
 *
 * Not the design-variant system: `pickView` / `Variant` (grid | forge) choose a
 * layout per request; a design option is chosen by which branch is built.
 *
 * ── Styling hooks used by an option's stylesheet ──────────────────────────
 *
 * Scope: `data-site="public"` marks every public surface — the public layout's
 * wrapper, plus login, reset, reset/new, unsubscribe and the root 404, which
 * sit outside it. Never on /console or /dashboard. A stylesheet scopes every
 * rule to `[data-site="public"]` so it can't reach the console by accident.
 *
 * Parts: `data-part="…"` names an element a stylesheet may restyle. They have
 * no visual effect on Current. A stylesheet selects these, `data-site` and
 * plain elements — never Tailwind utility classes, which change freely.
 * Naming, kebab-case, one value per element:
 *   - Shared structure, the same name on every page:
 *       page-head · page-title · page-intro · section · section-head ·
 *       section-title · see-all · panel · card-grid · carousel · carousel-dots ·
 *       empty-state · result-count · view-toggle · button-primary ·
 *       button-secondary · back-link · rich-text · map · share-buttons
 *   - Cards: the outer element is `<kind>-card` (story-card, video-card,
 *       event-card, member-tile, featured-member-card, machine-card,
 *       newsletter-card, member-news-card, …), and its insides use the shared
 *       card-image · card-body · card-title · card-meta · card-excerpt ·
 *       card-badge · card-eyebrow · card-play · card-cta, so
 *       `[data-part="story-card"] [data-part="card-title"]` reaches one kind
 *       and `[data-part="card-title"]` reaches all of them.
 *   - Filters and forms: filters · filter-pills · filter-pill · filter-clear ·
 *       filter-select (+ -control, -popup, -option) · search-form · form ·
 *       form-fieldset · form-label · form-input · form-error · form-notice ·
 *       form-submit (SubmitButton's default)
 *   - Chrome and shared pieces: site-header · site-logo · site-nav ·
 *       site-main · site-footer (+ -logo, -socials, -links, -signup, -legal) ·
 *       skip-link · cookie-banner · takeover-banner · industry-strip ·
 *       industry-strip-link · pagination · pagination-link · pagination-status ·
 *       ad-slot · ad-carousel · ad-placeholder · ad-slot-wrap · ad-label ·
 *       supplier-logos · supplier-logo · loading-skeleton · error-page ·
 *       not-found · not-found-header
 *   - Anything that belongs to one page or surface is prefixed with it:
 *       story-*, newsletter-*, join-*, industry-*, event-*, events-calendar-*,
 *       video-*, member-*, search-*, machine-*, auth-*, home-*.
 *   - grid-home's Band and Panel take a `part` prop that becomes their
 *       data-part, so a card built on Panel is labelled with its kind.
 * The full inventory, by file, is easiest to read straight from the source:
 *   grep -rno 'data-part="[^"]*"' src
 * Add a part with a small `staging` commit when a stylesheet needs one; never
 * rename or remove one without checking the option stylesheets that target it.
 */
import type { ComponentType } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { GridSiteFooter } from "@/components/GridSiteFooter";
import { GridHome } from "@/app/(public)/home.grid";
import { StoryPageView } from "@/components/story/StoryPageView";
import { IndustryPageView } from "@/components/industry/IndustryPageView";
import { NewsletterIssueView as CurrentNewsletterIssueView } from "@/components/newsletter/NewsletterIssueView";
import { JoinPageView } from "@/components/join/JoinPageView";

// ── Option stylesheet ─────────────────────────────────────────────────────
// Current has none. `classic` imports its stylesheet on the next line, e.g.
//   import "./classic/classic.css";
// The public layout imports this module, and so do the surfaces outside it
// (login, reset, reset/new, unsubscribe, the root 404), so the sheet reaches
// every public page. Not the root layout: that would put every public client
// component into the console's and dashboard's bundles too. Every rule in the
// sheet is scoped to [data-site="public"].

/**
 * Which design option this branch builds. `classic` sets "classic" when it
 * repoints the pieces below, so tests that only hold for Current can tell.
 */
export const DESIGN_OPTION: "current" | "classic" = "current";

type PropsOf<C> = C extends ComponentType<infer P> ? P : never;

/** Site header (public layout). */
export const Header: ComponentType<PropsOf<typeof SiteHeader>> = SiteHeader;
/** Site footer (public layout). Reads the path itself if it needs it; the layout passes nothing. */
export const Footer: ComponentType = GridSiteFooter;
/** Home view (`/`). */
export const HomeView: ComponentType<PropsOf<typeof GridHome>> = GridHome;
/** Story page body: the published story (`/news/[slug]`) and the story preview (`/preview/story/[id]`). */
export const StoryView: ComponentType<PropsOf<typeof StoryPageView>> = StoryPageView;
/** Industry page body (`/industry/[slug]`). */
export const IndustryView: ComponentType<PropsOf<typeof IndustryPageView>> = IndustryPageView;
/** Newsletter issue page body (`/newsletters/[slug]`). */
export const NewsletterIssueView: ComponentType<PropsOf<typeof CurrentNewsletterIssueView>> = CurrentNewsletterIssueView;
/** Join page (`/join`). */
export const JoinView: ComponentType = JoinPageView;
