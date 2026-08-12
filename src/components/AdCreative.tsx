"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportAdSeen } from "@/lib/ad-impressions";

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
  shape: "banner" | "rail";
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
        <>
          <Image src={desktop} alt={name} width={1280} height={170} className="hidden w-full rounded md:block" onLoad={checkLoaded} unoptimized />
          <Image src={mobile} alt={name} width={370} height={280} className="w-full rounded md:hidden" onLoad={checkLoaded} unoptimized />
        </>
      ) : (
        <Image src={mobile} alt={name} width={370} height={280} className="w-full rounded" onLoad={checkLoaded} unoptimized />
      )}
    </Link>
  );
}
