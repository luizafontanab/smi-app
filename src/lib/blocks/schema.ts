export type PageType = "story" | "member_profile" | "featured_machine" | "static_page";

export type BlockType =
  // anchors — the page's main content; admins position them, members write into them
  | "story_header" | "story_hero" | "story_body"
  | "profile_main" | "profile_video" | "machine_main" | "page_main"
  // decoration blocks admins may add/remove/reorder
  | "ad_banner"
  | "latest_news"
  | "member_news"
  | "join_cta"
  | "newsletter_signup"
  | "supplier_logos"
  | "back_link";

export type Block = { id: string; type: BlockType; props?: Record<string, unknown> };
export type PageLayout = { version: 1; blocks: Block[] };

/** Anchors per page type, in their one canonical relative order. */
export const ANCHORS: Record<PageType, BlockType[]> = {
  story: ["story_header", "story_hero", "story_body"],
  // profile_video is a fixed anchor, not a decoration: it's driven by the
  // member's own video_url, same as profile_main, not admin-added/removed —
  // but positioned separately from it (fix list: big, below the news block).
  member_profile: ["profile_main", "profile_video"],
  featured_machine: ["machine_main"],
  static_page: ["page_main"],
};

/** Decorations allowed per page type (member_news needs a member in context). */
export const DECORATIONS: Record<PageType, BlockType[]> = {
  story: ["back_link", "ad_banner", "latest_news", "member_news", "join_cta", "newsletter_signup", "supplier_logos"],
  member_profile: ["back_link", "ad_banner", "latest_news", "member_news", "join_cta", "newsletter_signup", "supplier_logos"],
  featured_machine: ["back_link", "ad_banner", "latest_news", "join_cta", "newsletter_signup", "supplier_logos"],
  // no member_news: a standalone page has no member in context
  static_page: ["back_link", "ad_banner", "latest_news", "join_cta", "newsletter_signup", "supplier_logos"],
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  story_header: "Title & meta (fixed)",
  story_hero: "Cover image (fixed)",
  story_body: "Article body (fixed)",
  profile_main: "Member profile (fixed)",
  profile_video: "Company video (fixed)",
  machine_main: "Machine listing (fixed)",
  page_main: "Page content (fixed)",
  ad_banner: "Advert slot (rotates)",
  latest_news: "Latest news cards",
  member_news: "This member's news",
  join_cta: "Become a Member",
  newsletter_signup: "Newsletter signup",
  supplier_logos: "Supplier logos",
  back_link: "Back link",
};

const SLOT_PREFIX: Record<PageType, string> = {
  story: "story",
  member_profile: "member",
  featured_machine: "machine",
  static_page: "page",
};

/**
 * Slot keys are derived from ad-block POSITION only — a layout can never name
 * an advertiser or advert. Which artwork shows is the per-request uniform
 * shuffle's business (lib/adverts.ts), keeping the rotational-neutral contract.
 */
export function adSlotKeys(pageType: PageType, layout: PageLayout): string[] {
  const n = layout.blocks.filter((b) => b.type === "ad_banner").length;
  return Array.from({ length: n }, (_, i) => `${SLOT_PREFIX[pageType]}_ad_${i + 1}`);
}

/**
 * Slots for advert breaks the author placed inside a story body (see
 * splitAtAdBreaks). Same contract as adSlotKeys — position only, never an
 * advertiser — but a separate namespace on purpose: BlockRenderer walks the
 * layout's ad_banner keys by index, so appending these to that list would
 * desync the counter and mis-assign every advert on the page.
 */
export function bodyAdSlotKeys(count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `story_body_ad_${i + 1}`);
}

export function isAnchor(pageType: PageType, type: BlockType): boolean {
  return (ANCHORS[pageType] as string[]).includes(type);
}

/** Returns an error message, or null when the layout is valid. */
export function validateLayout(pageType: PageType, layout: unknown): string | null {
  if (typeof layout !== "object" || layout === null) return "layout must be an object";
  const l = layout as PageLayout;
  if (l.version !== 1) return "unknown layout version";
  if (!Array.isArray(l.blocks)) return "blocks must be an array";
  if (l.blocks.length > 15) return "too many blocks (max 15)";

  const anchors = ANCHORS[pageType];
  const allowed = new Set<string>([...anchors, ...DECORATIONS[pageType]]);
  const ids = new Set<string>();

  for (const b of l.blocks) {
    if (typeof b !== "object" || b === null || typeof b.id !== "string" || !b.id) return "every block needs a string id";
    if (ids.has(b.id)) return `duplicate block id "${b.id}"`;
    ids.add(b.id);
    if (!allowed.has(b.type)) return `block type "${b.type}" is not allowed on ${pageType} pages`;
    if (b.type === "ad_banner" && b.props && Object.keys(b.props).length > 0) {
      return "advert blocks take no settings — rotation decides what shows";
    }
    if (b.type === "back_link") {
      const { label, href } = (b.props ?? {}) as { label?: unknown; href?: unknown };
      if (typeof label !== "string" || !label || typeof href !== "string" || !href.startsWith("/")) {
        return "back link needs a label and an internal href";
      }
    }
    if (b.type === "latest_news" && b.props?.limit !== undefined) {
      const limit = b.props.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 8) {
        return "news card limit must be 1–8";
      }
    }
    // member_news may go down to 0 ("show every story about this member") —
    // safe because it's scoped to one member's own story count, unlike
    // latest_news which would mean "every published story site-wide".
    if (b.type === "member_news" && b.props?.limit !== undefined) {
      const limit = b.props.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 0 || limit > 8) {
        return "news card limit must be 0–8 (0 shows every story)";
      }
    }
  }

  const seen = l.blocks.filter((b) => isAnchor(pageType, b.type)).map((b) => b.type);
  if (seen.length !== anchors.length || anchors.some((a, i) => seen[i] !== a)) {
    return "main content blocks must each appear exactly once, in order";
  }
  if (l.blocks[0]?.type === "ad_banner") return "a page may not open with an advert";
  return null;
}
