import Link from "next/link";
import { AdSlot } from "@/components/AdSlot";
import { BlockRenderer, STORY_AD_WRAPPER } from "@/components/blocks/BlockRenderer";
import { StoryBody } from "@/components/StoryBody";
import { StorySocialLinks } from "@/components/StorySocialLinks";
import { StoryMain, storyAnchors } from "@/components/story/StoryArticle";
import type { StoryPageView } from "@/components/story/StoryPageView";
import { adSlotKeys, isAnchor, type Block } from "@/lib/blocks/schema";

/**
 * Classic's story page body (hook point `StoryView` in src/components/design-option.ts;
 * spec #68, #74). The published story (/news/[slug]) and the draft preview
 * (/preview/story/[id]) both render it, with the same props as Current's
 * StoryPageView; the routes keep the data, the view record and the JSON-LD.
 *
 * Top to bottom: "‹ Back to News", then ONE narrow white panel holding the
 * story's header, hero and body, the share row and the member tiles in a
 * single column under the article (no sidebar), then whatever the admin's
 * layout puts after the article — adverts, Latest News, the join and sign-up
 * blocks — outside the panel, at the page's width.
 *
 * The layout still decides the order. It is cut in two after its last anchor
 * (story_header / story_hero / story_body): everything up to there goes in the
 * panel, the rest follows it. The layout's back_link block is drawn above the
 * panel in Classic's "‹" form instead of where it sits, so there is only one.
 *
 * Advert positions are dealt by index across the WHOLE layout (adSlotKeys), so
 * the cut must not renumber them. The panel's half is a prefix of the layout
 * and goes through BlockRenderer as is (dropping back_link, which takes no
 * slot, changes no index), keeping its ad/hero swap on phones. The tail's
 * adverts are drawn here with their whole-layout key, and its other blocks go
 * through BlockRenderer a run at a time.
 */
export function ClassicStoryView({ story, categories, cover, members, socialPosts, data, path }: Parameters<typeof StoryPageView>[0]) {
  const { slots, showPlaceholders, bodyKeys, segments } = data;
  const keys = adSlotKeys("story", data.layout);

  // Same breaks as Current's StoryPageView: an empty slot renders no wrapper.
  const adSlot = (key: string, part?: string) => {
    const ads = slots.get(key) ?? [];
    return ads.length || showPlaceholders
      ? <div data-part={part} className={STORY_AD_WRAPPER}><AdSlot adverts={ads} slotKey={key} showPlaceholders={showPlaceholders} path={path} /></div>
      : null;
  };
  const body = (
    <StoryBody
      segments={segments}
      companyLinks={data.companyLinks}
      className="mt-6"
      breaks={bodyKeys.map((key) => adSlot(key))}
    />
  );
  const anchors = storyAnchors({
    story,
    categories,
    cover,
    // "inline": one column, the member tiles under the article.
    main: <StoryMain body={body} share={<StorySocialLinks posts={socialPosts} />} members={members} layout="inline" />,
  });

  const blocks = data.layout.blocks;
  const back = blocks.find((b) => b.type === "back_link")?.props as { label: string; href: string } | undefined;
  let lastAnchor = -1;
  blocks.forEach((b, i) => {
    if (isAnchor("story", b.type)) lastAnchor = i;
  });
  const inPanel = blocks.slice(0, lastAnchor + 1).filter((b) => b.type !== "back_link");

  // The tail: adverts carry their whole-layout key; other blocks go in runs.
  let adIndex = inPanel.filter((b) => b.type === "ad_banner").length;
  const tail: React.ReactNode[] = [];
  let run: Block[] = [];
  const flush = () => {
    if (run.length) tail.push(renderBlocks(run, `run-${tail.length}`));
    run = [];
  };
  const renderBlocks = (list: Block[], key: string) => (
    <BlockRenderer
      key={key}
      pageType="story"
      layout={{ ...data.layout, blocks: list }}
      slots={slots}
      latestStories={data.latest}
      memberStories={[]}
      supplierLogos={data.logos}
      showPlaceholders={showPlaceholders}
      path={path}
      adWrapperClassName={STORY_AD_WRAPPER}
      anchors={anchors}
    />
  );
  for (const block of blocks.slice(lastAnchor + 1)) {
    if (block.type === "back_link") continue;
    if (block.type === "ad_banner") {
      flush();
      const ad = adSlot(keys[adIndex++], "ad-slot-wrap");
      if (ad) tail.push(<div key={block.id}>{ad}</div>);
    } else {
      run.push(block);
    }
  }
  flush();

  return (
    <>
      {back && (
        <div data-part="back-link">
          <Link href={back.href} className="tap">‹ {back.label}</Link>
        </div>
      )}
      <div data-part="story-panel">{renderBlocks(inPanel, "panel")}</div>
      {tail}
    </>
  );
}
