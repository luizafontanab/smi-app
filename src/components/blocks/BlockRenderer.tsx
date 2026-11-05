import Link from "next/link";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { JoinCta } from "@/components/JoinCta";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { SIGNUP_SURFACES } from "@/lib/newsletter-consent";
import { Carousel, StoryCard } from "@/components/StoryCard";
import type { LiveAdvert } from "@/lib/adverts";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import { adSlotKeys, isAnchor, type Block, type PageLayout, type PageType } from "@/lib/blocks/schema";

type Props = {
  pageType: PageType;
  layout: PageLayout;
  /** Pre-rendered main-content anchors, keyed by block type. */
  anchors: Partial<Record<string, React.ReactNode>>;
  /** Rotation results per derived slot key (from dealSlots — never reordered here). */
  slots?: Map<string, LiveAdvert[]>;
  latestStories?: StoryCardType[];
  memberStories?: StoryCardType[];
  /** Every published story featuring the member — memberStories is only the carousel's first page. */
  memberStoriesTotal?: number;
  /** Where the carousel's "See more" goes; shown only when memberStoriesTotal exceeds what it holds. */
  memberStoriesHref?: string;
  memberName?: string;
  supplierLogos?: LiveAdvert[];
  /** Draw empty slots' footprints — resolved per request by showAdPlaceholders(). */
  showPlaceholders?: boolean;
  /** The page this layout renders on — carried into any ad_banner block's impression beacon. */
  path: string;
  /** Wrapper around each ad_banner slot. The margin lives here, so a page that
   *  sizes its adverts differently (the story page) passes its own. */
  adWrapperClassName?: string;
};

/**
 * Story-page advert wrapper (Jas 13/10 item 6: "the mobile adverts were a tad
 * overpowering"). Below md a banner shows its 370×280 mobile artwork, which at
 * full phone width filled most of the screen; capped at 300px and centred it
 * reads as an advert in the article rather than a wall. From md up the desktop
 * artwork is a 1280×170 strip, so the cap comes off. Story page only — other
 * pages' adverts were not part of the feedback.
 */
export const STORY_AD_WRAPPER = "my-8 mx-auto w-full max-w-[300px] md:max-w-none";

/**
 * Renders a page's block layout. Ad blocks are position-derived slots filled
 * upstream by the uniform shuffle — this component must never pick or reorder
 * adverts (rotational-neutral contract).
 */
export function BlockRenderer({ pageType, layout, anchors, slots, latestStories, memberStories, memberStoriesTotal, memberStoriesHref, memberName, supplierLogos, showPlaceholders = false, path, adWrapperClassName = "my-8" }: Props) {
  const keys = adSlotKeys(pageType, layout);
  let adIndex = 0;

  const renderBlock = (block: Block): React.ReactNode => {
    if (isAnchor(pageType, block.type)) {
      return <div key={block.id}>{anchors[block.type] ?? null}</div>;
    }
    switch (block.type) {
      case "ad_banner": {
        const key = keys[adIndex++];
        const ads = slots?.get(key) ?? [];
        // the wrapper carries margin, so it must not render around a null slot
        return ads.length || showPlaceholders
          ? <div key={block.id} className={adWrapperClassName}><AdSlot adverts={ads} slotKey={key} showPlaceholders={showPlaceholders} path={path} /></div>
          : null;
      }
      case "back_link": {
        const { label, href } = block.props as { label: string; href: string };
        return (
          <div key={block.id} className="mt-6">
            {/* tap: a 20px-tall text link was the only way back on a phone (#33 C16) */}
            <Link href={href} className="tap text-sm text-graphite hover:text-ink">← {label}</Link>
          </div>
        );
      }
      case "latest_news": {
        const limit = typeof block.props?.limit === "number" ? block.props.limit : 4;
        if (!latestStories?.length) return null;
        return (
          <section key={block.id} className="mt-10">
            <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-ink">Latest News</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {latestStories.slice(0, limit).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
            </div>
          </section>
        );
      }
      case "member_news": {
        // A carousel of whatever the page fetched (memberBySlug caps it at
        // MEMBER_STORY_CAROUSEL), not a grid cut to the block's limit — any
        // stored `limit` on an older layout row is ignored. Past the cap,
        // "See more" opens the Newsroom filtered to this member.
        if (!memberStories?.length) return null;
        const more = memberStoriesHref && (memberStoriesTotal ?? 0) > memberStories.length ? memberStoriesHref : undefined;
        return (
          <Carousel key={block.id} title={`Stories featuring ${memberName ?? "this member"}`} href={more} linkLabel="See more →">
            {memberStories.map((s) => (
              // fixed width from sm, as on the newsroom/industry rails: the
              // carousel is a flex row, so an auto-width card would collapse.
              // On a phone a lone card fills the column and several peek at
              // 85%, rather than 256px leaving a dead strip beside it (#33).
              <div key={s.id} className={`${memberStories.length === 1 ? "w-full" : "w-[85%]"} shrink-0 sm:w-64`}><StoryCard story={s} showExcerpt={false} /></div>
            ))}
          </Carousel>
        );
      }
      case "join_cta":
        return <JoinCta key={block.id} />;
      case "newsletter_signup":
        return (
          <section key={block.id} className="my-10 rounded-xl bg-graphite/10 p-6">
            <h2 className="font-bold text-ink">{SIGNUP_SURFACES.page_block.heading}</h2>
            <div className="mt-3 max-w-md"><NewsletterSignup surface="page_block" /></div>
          </section>
        );
      case "supplier_logos":
        return supplierLogos?.length || showPlaceholders ? (
          <div key={block.id} className="-mx-4 mt-8"><SupplierLogos adverts={supplierLogos ?? []} showPlaceholders={showPlaceholders} /></div>
        ) : null;
      default:
        return null;
    }
  };

  // An advert directly above the story's cover (the default story layout, and
  // any stored layout that keeps that order) put headline → 300px advert →
  // cover on a phone, so the first screen after tapping a story held no
  // article at all (#33 C1). Below md the pair swaps, cover first. Detected
  // here rather than changed in the default, so layouts admins have already
  // saved get the same treatment. The ad keeps its slot key, because keys are
  // dealt by position in the layout.
  //
  // The swap is made in the SOURCE, not with CSS `order`: the advert renders
  // twice, before the hero from md up and after it below md, each copy
  // display:none at the other width. A CSS-only swap left the advert first in
  // tab and screen-reader order while it was drawn second. The hero renders
  // once (it carries the h1). A hidden copy never counts an impression —
  // AdCreative only counts an image with an offsetParent.
  const out: React.ReactNode[] = [];
  const blocks = layout.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    if (pageType === "story" && block.type === "ad_banner" && next?.type === "story_hero") {
      // One render, placed twice: renderBlock advances the slot-key counter,
      // so calling it twice would deal the second copy the next slot's key.
      const ad = renderBlock(block);
      const hero = renderBlock(next);
      if (ad) out.push(<div key={`${block.id}:md`} className="max-md:hidden">{ad}</div>);
      out.push(hero);
      if (ad) out.push(<div key={`${block.id}:phone`} className="md:hidden">{ad}</div>);
      i++;
      continue;
    }
    out.push(renderBlock(block));
  }
  return <>{out}</>;
}
