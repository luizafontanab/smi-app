import Link from "next/link";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { JoinCta } from "@/components/JoinCta";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { StoryCard } from "@/components/StoryCard";
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
export function BlockRenderer({ pageType, layout, anchors, slots, latestStories, memberStories, memberName, supplierLogos, showPlaceholders = false, path, adWrapperClassName = "my-8" }: Props) {
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
          case "latest_news":
          case "member_news": {
            const stories = block.type === "latest_news" ? latestStories : memberStories;
            const limit = typeof block.props?.limit === "number" ? block.props.limit : 4;
            const title = block.type === "latest_news" ? "Latest News" : `Stories featuring ${memberName ?? "this member"}`;
            if (!stories?.length) return null;
            // limit 0 only ever means "show every story" for member_news — guarded
            // by block type here too, in case a stale layout row has stray data.
            const shown = block.type === "member_news" && limit === 0 ? stories : stories.slice(0, limit);
            return (
              <section key={block.id} className="mt-10">
                <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-ink">{title}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {shown.map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
                </div>
              </section>
            );
          }
          case "join_cta":
            return <JoinCta key={block.id} />;
          case "newsletter_signup":
            return (
              <section key={block.id} className="my-10 rounded-xl bg-graphite/10 p-6">
                <h2 className="font-bold text-ink">The monthly round-up, straight to your inbox</h2>
                <div className="mt-3 max-w-md"><NewsletterSignup /></div>
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
