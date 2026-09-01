"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportAdSeen } from "@/lib/ad-impressions";

/**
 * Slot footprints. Declared here rather than in AdSlot because AdSlot reaches
 * into server-only modules, and this is the client leaf both sides can share.
 *
 *   banner      1280×170 desktop / 370×280 mobile — the only two-creative shape
 *   rail        370×280 in a sidebar column
 *   skyscraper  300×600, desktop only
 *   mpu         300×250 box
 *   in_feed     native card, sized to StoryCard size="sm"
 */
export type AdShape = "banner" | "rail" | "skyscraper" | "mpu" | "in_feed";

/**
 * The visible half of an advert slot, and the only place an impression is
 * counted. Two conditions must both hold, because either alone lies:
 *
 *  - the artwork actually loaded (onLoad) — an ad blocker or a broken path
 *    leaves a blank box, and a blank box was never an advert;
 *  - at least half of it stayed on screen for a second — the ordinary
 *    advertising standard. Counting at render meant every below-the-fold slot
 *    on the homepage scored an impression nobody ever saw.
 *
 * Rotation is still decided upstream in lib/adverts.ts — nothing here picks,
 * reorders or filters by advertiser.
 */

const VISIBLE_RATIO = 0.5;
const VISIBLE_MS = 1000;

type Props = {
  advertId: string;
  name: string;
  href: string;
  desktop: string;
  mobile: string;
  shape: AdShape;
};

export function AdCreative({ advertId, name, href, desktop, mobile, shape }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const counted = useRef(false);
  const [loaded, setLoaded] = useState(false);

  /**
   * Only the artwork the reader can actually see counts, and only if it decoded:
   * a blocked or broken image reports complete with naturalWidth 0, and the
   * off-breakpoint copy is display:none. Checked rather than trusting onLoad,
   * because a cached advert finishes loading before React hydrates and its load
   * event is long gone by the time a handler exists — which would silently stop
   * counting impressions for every returning reader.
   */
  const checkLoaded = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const visible = [...el.querySelectorAll("img")].filter((im) => im.offsetParent !== null);
    if (visible.some((im) => im.complete && im.naturalWidth > 0)) setLoaded(true);
  }, []);

  useEffect(checkLoaded, [checkLoaded]);

  useEffect(() => {
    const el = ref.current;
    if (!loaded || counted.current || !el) return;

    // No IntersectionObserver: count on load rather than never. Undercounting a
    // booked advert is as wrong as overcounting one.
    if (typeof IntersectionObserver === "undefined") {
      counted.current = true;
      reportAdSeen(advertId);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio >= VISIBLE_RATIO) {
            timer ??= setTimeout(() => {
              counted.current = true;
              io.disconnect();
              reportAdSeen(advertId);
            }, VISIBLE_MS);
          } else if (timer) {
            // scrolled away before it earned the impression — start again next time
            clearTimeout(timer);
            timer = null;
          }
        }
      },
      { threshold: [VISIBLE_RATIO] },
    );
    io.observe(el);

    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
  }, [advertId, loaded]);

  return (
    <Link ref={ref} href={href} className="block" aria-label={`Advert: ${name}`}>
      {shape === "banner" ? (
        // The only shape with two creatives: a 1280×170 strip cannot survive a
        // phone, so the mobile artwork is a different shape, not a resize.
        <>
          <Image src={desktop} alt={name} width={1280} height={170} className="hidden w-full rounded md:block" onLoad={checkLoaded} unoptimized />
          <Image src={mobile} alt={name} width={370} height={280} className="w-full rounded md:hidden" onLoad={checkLoaded} unoptimized />
        </>
      ) : shape === "skyscraper" ? (
        // Desktop artwork at its own aspect; no mobile creative is booked for it.
        <Image src={desktop} alt={name} width={300} height={600} className="w-full rounded" onLoad={checkLoaded} unoptimized />
      ) : shape === "mpu" ? (
        // Same 300×250 box at every breakpoint — only the artwork swaps.
        // A crop meant for a phone-width column is genuinely different
        // creative from the desktop one, not just a resize, same reasoning
        // as banner above.
        <>
          <Image src={desktop} alt={name} width={300} height={250} className="hidden w-full rounded md:block" onLoad={checkLoaded} unoptimized />
          <Image src={mobile} alt={name} width={300} height={250} className="w-full rounded md:hidden" onLoad={checkLoaded} unoptimized />
        </>
      ) : (
        // rail and in_feed both take the squarer mobile creative.
        <Image src={mobile} alt={name} width={370} height={280} className="w-full rounded" onLoad={checkLoaded} unoptimized />
      )}
    </Link>
  );
}
