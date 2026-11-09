import { AdSlot } from "@/components/AdSlot";
import { BlockRenderer, STORY_AD_WRAPPER } from "@/components/blocks/BlockRenderer";
import { StoryBody } from "@/components/StoryBody";
import { StorySocialLinks } from "@/components/StorySocialLinks";
import { StoryMain, storyAnchors, type StoryArticleMember, type StoryArticleStory } from "@/components/story/StoryArticle";
import type { StoryPageData } from "@/lib/story-page";

/**
 * A story page as readers see it: the admin's block layout around the story's
 * own header, hero and body. The one renderer behind /news/[slug] and the
 * draft preview — the only differences are the data (preview data never holds
 * a real advert) and the `path` the advert beacons would report against.
 *
 * Live-site structure: single column — title/meta, ad below meta, hero, body,
 * then post-article blocks. Order comes from the (admin-arranged) layout.
 */
export function StoryPageView({ story, categories, cover, coverIsLogo = false, members, socialPosts, data, path }: {
  story: StoryArticleStory;
  /** stories.social_posts — SMI's own posts of this story (Jas 13/10 item 8). */
  socialPosts: unknown;
  categories: { slug: string; name: string }[];
  cover: string | null;
  /** `cover` is the member's logo standing in for one (lib/story-image). */
  coverIsLogo?: boolean;
  /** Tagged members, primary first, already gated by isMemberLinkable — none, no sidebar. */
  members: StoryArticleMember[];
  data: StoryPageData;
  path: string;
}) {
  const { slots, showPlaceholders, bodyKeys, segments } = data;
  const body = (
    <StoryBody
      segments={segments}
      companyLinks={data.companyLinks}
      className="mt-6"
      breaks={bodyKeys.map((key) => {
        const ads = slots.get(key) ?? [];
        // same rule as BlockRenderer's ad_banner: the margin-carrying
        // wrapper must not render around an empty slot
        return ads.length || showPlaceholders
          ? <div className={STORY_AD_WRAPPER}><AdSlot adverts={ads} slotKey={key} showPlaceholders={showPlaceholders} path={path} /></div>
          : null;
      })}
    />
  );

  return (
    <BlockRenderer
      pageType="story"
      layout={data.layout}
      slots={slots}
      latestStories={data.latest}
      memberStories={[]}
      supplierLogos={data.logos}
      showPlaceholders={showPlaceholders}
      path={path}
      adWrapperClassName={STORY_AD_WRAPPER}
      anchors={storyAnchors({
        story,
        categories,
        cover,
        coverIsLogo,
        main: <StoryMain body={body} share={<StorySocialLinks posts={socialPosts} />} members={members} />,
      })}
    />
  );
}
