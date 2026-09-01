export type AdFormat = { key: string; name: string; detail: string };

export const AD_FORMAT_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

/** Falls back to this when the "advert_formats" settings row hasn't been edited yet. */
export const DEFAULT_AD_FORMATS: AdFormat[] = [
  { key: "A", name: "Sitewide website banners", detail: "Randomised rotation across homepage, news, articles, videos and the member directory. Desktop 1280×170px, mobile 370×280px. No advertiser owns a position — every slot rotates." },
  { key: "B", name: "Featured Member", detail: "Your logo and profile in the homepage carousel and higher visibility in Find a Member." },
  { key: "C", name: "Homepage Takeover", detail: "Your colour scheme across homepage, news and videos with top banner placement. Hex colour required; WCAG 2.1 A compliance applies." },
  { key: "D", name: "Supplier Logo", detail: "Rotating logo carousel on the homepage and news pages." },
  { key: "E", name: "Editor's Monthly E-Newsletter", detail: "Banner (560×300px, 18pt minimum font) or 'In Association With' logo (250×60px). 12 issues a year to ~2,500 trade readers." },
  { key: "F", name: "Banner design help", detail: "One-off design service for desktop and mobile banners." },
];
