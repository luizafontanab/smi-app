import Link from "next/link";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { JoinCta } from "@/components/JoinCta";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { SIGNUP_SURFACES } from "@/lib/newsletter-consent";
import { Carousel, StoryCard } from "@/components/StoryCard";
import type { LiveAdvert } from "@/lib/adverts";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import { adSlotKeys, isAnchor, type PageLayout, type PageType } from "@/lib/blocks/schema";

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

  return (
    <>
      {layout.blocks.map((block) => {
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
                <Link href={href} className="text-sm text-graphite hover:text-ink">← {label}</Link>
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
                  // fixed width, as on the newsroom/industry rails: the carousel
                  // is a flex row, so an auto-width card would collapse
                  <div key={s.id} className="w-64 shrink-0"><StoryCard story={s} showExcerpt={false} /></div>
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
      })}
    </>
  );
}
