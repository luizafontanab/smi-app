import "server-only";
import { dealSlots, liveAdverts, showAdPlaceholders, type LiveAdvert } from "@/lib/adverts";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys, bodyAdSlotKeys, type PageLayout } from "@/lib/blocks/schema";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { isMemberLinkable } from "@/lib/member-visibility";
import { publishedStories, storyIndustrySlug, storyMembers, type StoryCard } from "@/lib/queries";
import { splitAtAdBreaks } from "@/lib/sanitize";
import { taggedMembers } from "@/lib/story-members";
import { companyLinksFor, type CompanyLink } from "@/lib/company-link";

export type StoryPageData = {
  layout: PageLayout;
  segments: string[];
  bodyKeys: string[];
  slots: Map<string, LiveAdvert[]>;
  latest: StoryCard[];
  logos: LiveAdvert[];
  showPlaceholders: boolean;
  industrySlug: string | null;
  /** Every member the story features that may be linked, primary first (Jas 13/10 item 12). */
  members: { name: string; slug: string; logoUrl: string | null }[];
  /**
   * A name + website line per featured member with a website, primary first,
   * closing the story (Luiza, 15 Oct; lib/company-link).
   */
  companyLinks: CompanyLink[];
};

/**
 * Everything a story page needs besides the story row itself — shared by the
 * public page and the draft preview so the two cannot drift (Jas 13/10 items
 * 10/15).
 *
 * `preview` keeps every advert footprint but never a real creative: slots come
 * back empty and placeholders are forced on, so the author sees where adverts
 * will sit while no AdCreative mounts — and an unmounted creative can't send
 * an impression beacon for a page no reader has seen.
 *
 * Banners and the placeholder flag don't depend on the layout, so they join the
 * first round instead of waiting behind getLayout — only the two
 * layout-conditional fetches stay in round two.
 */
export async function loadStoryPageData(
  story: { id: string; slug: string; body: string | null; member_id: string | null },
  { preview = false }: { preview?: boolean } = {},
): Promise<StoryPageData> {
  const [banners, placeholders, layout, featured] = await Promise.all([
    preview ? Promise.resolve([] as LiveAdvert[]) : liveAdverts("banner"),
    preview ? Promise.resolve(true) : showAdPlaceholders(),
    getLayout("story", story.id),
    // Public: publicDb, where RLS already limits it to published pairings and
    // public members. Preview: the story isn't published, so that read would
    // come back empty — service role, then the same linkability rule by hand.
    preview
      ? taggedMembers(serviceDb(), story.id, story.member_id).then((ms) => ms.filter((m) => isMemberLinkable(m)))
      : storyMembers(story.id, story.member_id),
  ]);
  const wantsLatest = layout.blocks.some((b) => b.type === "latest_news");
  const wantsLogos = !preview && layout.blocks.some((b) => b.type === "supplier_logos");
  const [{ stories: more }, logos, industrySlug] = await Promise.all([
    wantsLatest ? publishedStories({ limit: 5 }) : Promise.resolve({ stories: [] as StoryCard[] }),
    wantsLogos ? liveAdverts("supplier_logo") : Promise.resolve([] as LiveAdvert[]),
    // the story's own industry, for the public page's viewed_cats cookie
    preview ? Promise.resolve(null) : storyIndustrySlug(story.id),
  ]);

  // Split once: the segments render the body and their count is what derives the
  // in-body slot keys. Both key sets feed ONE deal, so the "no advert twice on a
  // page" guarantee spans the layout's slots and the author's breaks alike.
  const segments = splitAtAdBreaks(story.body);
  const bodyKeys = bodyAdSlotKeys(segments.length - 1);
  const slots = dealSlots(banners, [...adSlotKeys("story", layout), ...bodyKeys]);

  return {
    layout,
    segments,
    bodyKeys,
    slots,
    latest: more.filter((s) => s.slug !== story.slug).slice(0, 4),
    logos,
    showPlaceholders: placeholders,
    industrySlug,
    members: featured.map((m) => ({ name: m.name, slug: m.slug, logoUrl: mediaUrl(m.logo_path) })),
    companyLinks: companyLinksFor(featured, story.member_id),
  };
}
