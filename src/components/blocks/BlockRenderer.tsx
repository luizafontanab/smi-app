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
};

/**
 * Renders a page's block layout. Ad blocks are position-derived slots filled
 * upstream by the uniform shuffle — this component must never pick or reorder
 * adverts (rotational-neutral contract).
 */
export function BlockRenderer({ pageType, layout, anchors, slots, latestStories, memberStories, memberName, supplierLogos, showPlaceholders = false }: Props) {
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
              ? <div key={block.id} className="my-8"><AdSlot adverts={ads} slotKey={key} showPlaceholders={showPlaceholders} /></div>
              : null;
          }
          case "back_link": {
            const { label, href } = block.props as { label: string; href: string };
            return (
              <div key={block.id} className="mt-6">
                <Link href={href} className="text-sm text-gray-400 hover:text-ink">← {label}</Link>
              </div>
            );
          }
          case "latest_news":
          case "member_news": {
            const stories = block.type === "latest_news" ? latestStories : memberStories;
            const limit = typeof block.props?.limit === "number" ? block.props.limit : 4;
            const title = block.type === "latest_news" ? "Latest News" : `Stories featuring ${memberName ?? "this member"}`;
            if (!stories?.length) return null;
            return (
              <section key={block.id} className="mt-10">
                <h2 className="mb-3 text-lg font-bold uppercase tracking-wide text-ink">{title}</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {stories.slice(0, limit).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
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
