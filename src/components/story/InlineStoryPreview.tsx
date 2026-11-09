import { AdSlot } from "@/components/AdSlot";
import { STORY_AD_WRAPPER } from "@/components/blocks/BlockRenderer";
import { StoryBody } from "@/components/StoryBody";
import { StoryHeader, StoryHero, StoryMain, type StoryArticleMember, type StoryArticleStory } from "@/components/story/StoryArticle";
import { splitAtAdBreaks } from "@/lib/sanitize";
import type { CompanyLink } from "@/lib/company-link";
import { bodyAdSlotKeys } from "@/lib/blocks/schema";

/**
 * The story as it publishes, compact enough to sit in an editor page — same
 * header, hero, body typography and member box as /news/[slug], with the
 * author's advert breaks drawn as advert footprints (as readers will meet
 * them) rather than the dashed authoring marker. The layout's own blocks
 * (top/foot adverts, latest news) are left to the full-page preview.
 */
export function InlineStoryPreview({ story, categories, cover, coverIsLogo = false, body, members, share, companyLinks = [] }: {
  story: StoryArticleStory;
  categories: { slug: string; name: string }[];
  cover: string | null;
  /** `cover` is the member's logo standing in for one (lib/story-image). */
  coverIsLogo?: boolean;
  body: string | null;
  members: StoryArticleMember[];
  share?: React.ReactNode;
  companyLinks?: readonly CompanyLink[];
}) {
  const segments = splitAtAdBreaks(body);
  const keys = bodyAdSlotKeys(segments.length - 1);
  return (
    <div data-testid="story-preview">
      <StoryHeader story={story} categories={categories} />
      <StoryHero cover={cover} focus={story.cover_focus} logo={coverIsLogo} />
      <StoryMain
        body={
          <StoryBody
            segments={segments}
            companyLinks={companyLinks}
            className="mt-6"
            breaks={keys.map((key) => (
              <div key={key} className={STORY_AD_WRAPPER}>
                <AdSlot adverts={[]} slotKey={key} showPlaceholders path="/console" />
              </div>
            ))}
          />
        }
        share={share}
        members={members}
        layout="inline"
      />
    </div>
  );
}
