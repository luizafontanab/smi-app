import Image from "next/image";
import Link from "next/link";
import { advertHref, pickOne, type LiveAdvert } from "@/lib/adverts";
import { mediaUrl } from "@/lib/db/server";
import { AdCreative, type AdShape } from "@/components/AdCreative";

export type { AdShape };

/**
 * Renders one advert slot. Which adverts land here was decided by an
 * unbiased per-request shuffle upstream (lib/adverts.ts) — this component
 * only displays; it must never reorder or filter by advertiser.
 *
 * A2.10: the slot has up to ~3 eligible adverts but shows one — picked
 * uniformly at random on this render, so it stays static for the rest of the
 * page load rather than cycling. Not a carousel, "for now" per the open
 * question logged in docs/HUMAN-TODO.md §5.4.
 *
 * `showPlaceholders` draws the slot's footprint when nothing is booked, so
 * layout stays checkable on an empty inventory. It is resolved per request by
 * showAdPlaceholders() and defaults to off, so a caller that forgets to pass it
 * shows readers nothing rather than a hollow box.
 */
export function AdSlot({ adverts, shape = "banner", slotKey, showPlaceholders = false }: { adverts: LiveAdvert[]; shape?: AdShape; slotKey?: string; showPlaceholders?: boolean }) {
  const ad = pickOne(adverts);
  if (!ad) return showPlaceholders ? <AdPlaceholder shape={shape} slotKey={slotKey} /> : null;
  return (
    <AdCreative
      advertId={ad.advertId}
      name={ad.name}
      href={advertHref(ad)}
      desktop={mediaUrl(ad.desktopPath)!}
      mobile={mediaUrl(ad.mobilePath)!}
      shape={shape}
    />
  );
}

// No display utility here — each variant sets its own, so `hidden`/`flex` never collide.
const PLACEHOLDER_BOX =
  "w-full flex-col items-center justify-center gap-1 rounded border-2 border-dashed border-graphite/40 bg-graphite/5 text-center";

/**
 * Scaffolding, not content: no link, no impression, hidden from screen
 * readers. Banners reserve exactly the real advert's footprint at each
 * breakpoint; the side rail fills its column instead, so the rail lines up
 * with the story card beside it rather than leaving the gap the rails exist
 * to close (REQUIREMENTS.md:52).
 */
function AdPlaceholder({ shape, slotKey }: { shape: AdShape; slotKey?: string }) {
  if (shape === "rail") {
    return (
      // flex-1 eats the aside's leftover height; min-h keeps it honest when stacked on mobile
      <div aria-hidden="true" className="flex min-h-[280px] flex-1">
        <div className={`${PLACEHOLDER_BOX} flex h-full`}><PlaceholderLabel slotKey={slotKey} size="370×280" /></div>
      </div>
    );
  }
  if (shape === "skyscraper") {
    // Desktop-only inventory: too tall to be worth a mobile creative, and priced
    // on the assumption that only desktop traffic ever sees it.
    return (
      <div aria-hidden="true" className="hidden lg:block">
        <div className={`${PLACEHOLDER_BOX} flex aspect-[300/600]`}><PlaceholderLabel slotKey={slotKey} size="300×600" /></div>
      </div>
    );
  }
  if (shape === "mpu") {
    return (
      <div aria-hidden="true">
        <div className={`${PLACEHOLDER_BOX} flex aspect-[300/250]`}><PlaceholderLabel slotKey={slotKey} size="300×250" /></div>
      </div>
    );
  }
  if (shape === "in_feed") {
    // Matches StoryCard size="sm" so a sponsored card sits flush in a content
    // grid — the point of the format is that it doesn't break the rhythm.
    return (
      <div aria-hidden="true">
        <div className={`${PLACEHOLDER_BOX} flex h-32`}><PlaceholderLabel slotKey={slotKey} size="in-feed card" /></div>
      </div>
    );
  }
  return (
    <div aria-hidden="true">
      <div className={`${PLACEHOLDER_BOX} hidden aspect-[1280/170] md:flex`}><PlaceholderLabel slotKey={slotKey} size="1280×170" /></div>
      <div className={`${PLACEHOLDER_BOX} flex aspect-[370/280] md:hidden`}><PlaceholderLabel slotKey={slotKey} size="370×280" /></div>
    </div>
  );
}

function PlaceholderLabel({ slotKey, size }: { slotKey?: string; size: string }) {
  return (
    <>
      <p className="text-xs font-bold uppercase tracking-widest text-graphite">Advert space</p>
      <p className="font-mono text-[11px] text-graphite">{slotKey ? `${slotKey} · ${size}` : size}</p>
      <p className="text-[11px] text-graphite">No advertiser owns this space</p>
    </>
  );
}

export function SupplierLogos({ adverts, showPlaceholders = false }: { adverts: LiveAdvert[]; showPlaceholders?: boolean }) {
  if (adverts.length === 0 && !showPlaceholders) return null;
  return (
    <section className="border-t bg-white py-6">
      <div className="mx-auto max-w-6xl px-4">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-graphite">Suppliers</h2>
        <div className="flex flex-wrap items-center gap-6">
          {adverts.length > 0
            ? adverts.map((ad) => (
                <Link key={ad.advertId} href={advertHref(ad)}>
                  <Image src={mediaUrl(ad.mobilePath)!} alt={ad.name} width={120} height={60} className="h-12 w-auto" unoptimized />
                </Link>
              ))
            : Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="flex h-12 w-28 items-center justify-center rounded border-2 border-dashed border-graphite/40 bg-graphite/5 text-[11px] font-bold uppercase tracking-widest text-graphite"
                >
                  Logo
                </div>
              ))}
        </div>
      </div>
    </section>
  );
}
