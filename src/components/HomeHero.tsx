"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import type { HeroItem } from "@/lib/hero";

/**
 * The home hero: a full-bleed stage plus a rail of five cards.
 *
 * Card 0 is the current headline story. The stage shows it on load and returns
 * to it whenever the pointer leaves the hero. Hovering or focusing any card
 * promotes it to the stage.
 *
 * IT MUST NEVER ROTATE ON ITS OWN. That is a product decision, not an
 * oversight — there is exactly one useState in this file and deliberately no
 * useEffect, no setInterval and no timer of any kind. If you are here to add a
 * carousel timer, don't.
 *
 * Rendering notes:
 * - All five layers and all five cards are in the SSR HTML with item 0 active,
 *   so the headline and every link are crawlable and the CSS entrance plays
 *   before hydration. With JS off the stage still shows the headline and every
 *   card still navigates.
 * - The stage is a visual duplicate of the active card, so it is aria-hidden
 *   and its links are tabIndex -1. The rail carries all the semantics; a screen
 *   reader hears each story once, and nothing mutates silently under it.
 * - The rail thumbnail and the stage layer use the SAME URL string, and
 *   `unoptimized` adds no resize params — so this is five image requests, not
 *   ten. Don't "optimise" the rail to a smaller URL; it doubles the traffic.
 */
export function HomeHero({ items }: { items: HeroItem[] }) {
  const [active, setActive] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  if (items.length === 0) return null;

  // Leaving the hero resets to the headline. This sits on the <section>, not
  // the rail, so moving from a card up onto the stage keeps the promotion and
  // you can click the big CTA for the item you were just hovering.
  const onPointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (sectionRef.current?.contains(document.activeElement)) return; // keyboard focus wins
    setActive(0);
  };

  return (
    <section ref={sectionRef} className="hero" onPointerLeave={onPointerLeave}>
      {/* `/` had no h1 at all before this. */}
      <h1 className="sr-only">Sheet Metal Industries — news for UK sheet metal, fabrication and welding</h1>

      <div className="hero-media-stack absolute inset-0" aria-hidden="true">
        {items.map((item, i) => (
          <div key={item.key} className="hero-media-layer" data-active={i === active}>
            {item.image ? (
              <Image
                src={item.image}
                alt=""
                fill
                sizes="100vw"
                unoptimized
                className="hero-media object-cover"
                // Layer 0 is the LCP element and is always a story cover.
                // loading="lazy" would not defer 1-4 (they are in-viewport at
                // opacity 0), so fetchPriority is what keeps them behind it.
                {...(i === 0 ? { preload: true } : { fetchPriority: "low" as const })}
              />
            ) : (
              <div className="hero-media hero-media--empty">⚙</div>
            )}
          </div>
        ))}
        <div className="hero-scrim absolute inset-0" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-2 pt-12">
        {/* Stage copy — decorative duplicate of the active card. */}
        <div className="relative flex-1" aria-hidden="true">
          {items.map((item, i) => (
            <StageCopy key={item.key} item={item} active={i === active} initial={i === 0} />
          ))}
        </div>

        {items.length > 1 && (
          <>
            <h2 className="hero-rail-label mt-6">Up next</h2>
            <ul
              className="hero-rail"
              // React's onBlur is focusout, so it bubbles. Tabbing out of the
              // rail entirely returns the stage to the headline; moving between
              // cards does not (relatedTarget is still inside).
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setActive(0); }}
            >
              {items.map((item, i) => (
                <li key={item.key} style={{ "--i": i } as React.CSSProperties}>
                  <RailCard item={item} active={i === active} onActivate={() => setActive(i)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function StageCopy({ item, active, initial }: { item: HeroItem; active: boolean; initial: boolean }) {
  const body = (
    <>
      <p className="hero-eyebrow">{item.eyebrow}</p>
      <p className="hero-title" data-testid={active ? "hero-stage-title" : undefined}>{item.title}</p>
      {/* The story's opening lines — its excerpt where one exists, otherwise the
          start of the body (lib/hero.ts). Omitted rather than rendered empty, since
          an empty <p> still costs a flex gap. Videos have no article text to show. */}
      {item.kind === "story" && item.intro && <p className="hero-intro">{item.intro}</p>}
      <p className="hero-actions">
        <span className="hero-cta">{item.kind === "video" ? "▶ Watch" : "Read the story"}</span>
        <span className="hero-meta">{item.meta}</span>
      </p>
    </>
  );
  const props = {
    className: "hero-copy-layer",
    "data-active": active,
    "data-initial": initial ? "true" : undefined,
    tabIndex: -1, // the container is aria-hidden; focusable descendants would be a violation
  };
  return item.kind === "video" ? (
    <a href={item.href} target="_blank" rel="noopener" {...props}>{body}</a>
  ) : (
    <Link href={item.href} {...props}>{body}</Link>
  );
}

function RailCard({ item, active, onActivate }: { item: HeroItem; active: boolean; onActivate: () => void }) {
  const props = {
    className: "hero-card",
    "data-active": active,
    "data-testid": "hero-card",
    // Gate on mouse: on touch, pointerenter fires just before click and would
    // flash the stage mid-tap. This way the first tap simply navigates.
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === "mouse") onActivate(); },
    onFocus: onActivate, // tabbing the rail drives the stage exactly like hovering
  };
  const body = (
    <>
      <div className="hero-card-media">
        {item.image ? (
          <Image src={item.image} alt="" fill sizes="220px" unoptimized className="hero-card-img object-cover" />
        ) : (
          <div className="hero-card-img hero-media--empty">⚙</div>
        )}
        {item.kind === "video" && <span className="hero-play" aria-hidden="true">▶</span>}
      </div>
      <div className="hero-card-body">
        <p className="hero-card-eyebrow">{item.eyebrow}</p>
        <h3 className="hero-card-title">
          {item.title}
          {item.kind === "video" && <span className="sr-only"> — video, opens on YouTube</span>}
        </h3>
      </div>
    </>
  );
  return item.kind === "video" ? (
    <a href={item.href} target="_blank" rel="noopener" {...props}>{body}</a>
  ) : (
    <Link href={item.href} {...props}>{body}</Link>
  );
}
