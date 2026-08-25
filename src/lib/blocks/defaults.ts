import type { PageLayout, PageType } from "./schema";

/** Default templates mirroring the live site's page structure (fetched 2026-08-09). */
export const DEFAULT_LAYOUTS: Record<PageType, PageLayout> = {
  // Back link → title/meta → ad directly below meta → hero → body → latest news → ad → CTA → newsletter
  story: {
    version: 1,
    blocks: [
      { id: "back", type: "back_link", props: { label: "Back to News", href: "/news" } },
      { id: "header", type: "story_header" },
      { id: "ad-top", type: "ad_banner" },
      { id: "hero", type: "story_hero" },
      { id: "body", type: "story_body" },
      { id: "latest", type: "latest_news", props: { limit: 4 } },
      { id: "ad-foot", type: "ad_banner" },
      { id: "join", type: "join_cta" },
      { id: "newsletter", type: "newsletter_signup" },
    ],
  },
  // Profile → member's news → rotating banners → CTA
  member_profile: {
    version: 1,
    blocks: [
      { id: "main", type: "profile_main" },
      { id: "news", type: "member_news", props: { limit: 4 } },
      { id: "ad-1", type: "ad_banner" },
      { id: "join", type: "join_cta" },
    ],
  },
  // Listing → banners → CTA → newsletter
  featured_machine: {
    version: 1,
    blocks: [
      { id: "main", type: "machine_main" },
      { id: "ad-1", type: "ad_banner" },
      { id: "join", type: "join_cta" },
      { id: "newsletter", type: "newsletter_signup" },
    ],
  },
  // Page body → banner → newsletter. Deliberately the quietest default of the
  // four: About and Policies are read, not browsed on from, so no news grid and
  // no join CTA until an editor adds one.
  static_page: {
    version: 1,
    blocks: [
      { id: "main", type: "page_main" },
      { id: "ad-1", type: "ad_banner" },
      { id: "newsletter", type: "newsletter_signup" },
    ],
  },
};
