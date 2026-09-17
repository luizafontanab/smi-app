/**
 * The visibility products a member can request (no online payment — Jas
 * confirms, schedules and invoices). Shared by the advertising hub's
 * Information, Buy and Manage pages so names and keys can't drift.
 */
export const VISIBILITY_PRODUCTS = [
  { key: "featured_member", name: "Featured Member", detail: "Homepage carousel + higher directory ranking, by the month" },
  { key: "newsletter_slot", name: "Newsletter advert", detail: "560×300 banner in the monthly issue (~2,500 readers)" },
  { key: "banner_package", name: "Sitewide banners", detail: "Rotating banners across every page — impressions reported monthly" },
  { key: "featured_machine", name: "Featured Machine", detail: "Machine of the month promo page, by the week or month" },
] as const;

export const visibilityProductName = (key: string) =>
  VISIBILITY_PRODUCTS.find((p) => p.key === key)?.name ?? key;
