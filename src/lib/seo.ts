/**
 * Site-wide metadata constants, shared by the root layout and any page that
 * sets its own `openGraph`.
 *
 * Next merges metadata *shallowly*: a page that declares `openGraph` replaces
 * the layout's whole object, so siteName, locale and the fallback card are
 * silently dropped unless the page spreads them back in. Pages that set
 * `openGraph` should start from OG_BASE and fall back to SITE_CARD for images.
 * (A layout file can only export Next's own fields, hence this module.)
 */

export const SITE_NAME = "Sheet Metal Industries";

export const SITE_DESCRIPTION =
  "The voice of the UK sheet metal, fabrication and welding trade: industry news, member companies, machinery and events.";

export const OG_BASE = { siteName: SITE_NAME, locale: "en_GB" } as const;

/** The typographic card from app/opengraph-image.tsx — same size and alt it declares. */
export const SITE_CARD = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Sheet Metal Industries — UK sheet metal, fabrication & welding news",
} as const;
