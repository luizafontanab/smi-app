import Image from "next/image";
import Link from "next/link";
import { advertHref, type LiveAdvert } from "@/lib/adverts";
import { currentUser } from "@/lib/auth";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { youtubeId } from "@/lib/hero";
import type { StoryCard as StoryCardType } from "@/lib/queries";
import type { FeaturedMemberData, MachineCardData, VideoCardData } from "@/components/cards";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { MemberBadge } from "@/components/StoryCard";
import { Band, BtnBrand, BtnDark, CardTitle, Chip, Eyebrow, Meta, Panel } from "./ui";

/**
 * Cards for the grid design's homepage, drawn from the client's comps.
 *
 * These deliberately duplicate the shape — not the styling — of the shared
 * cards in components/cards.tsx and components/StoryCard.tsx. Those carry
 * rounded-lg + shadow-sm and a different type scale, and are used by the forge
 * homepage and by /news, /video and /member; growing a "flat uppercase"
 * variant prop on all four would put this design's decisions in everyone's
 * way. The cost is a second set of cards; the benefit is that nothing outside
 * the grid homepage can regress.
 *
 * Kept in step with the shared set where it matters rather than where it is
 * merely similar:
 *   · video thumbnails use thumbnail_path ?? ytimg (cards.tsx:33) and link to
 *     our own /video/{slug}, never straight out to YouTube
 *   · member news is badged wherever it sits among industry news — a
 *     commercial rule (DESIGN-QUOTES.md §7), not a style choice
 *   · covers honour the admin's crop box via focusStyle (lib/focus.ts)
 */

const PLACEHOLDER = (
  <span className="flex h-full items-center justify-center text-4xl text-graphite/25" aria-hidden="true">⚙</span>
);

/*
 * Minimums, not fixed heights: the cover is a flex-1 child, so when a card is
 * stretched by a taller neighbour in its grid row the slack goes into the
 * photograph instead of pooling as white space above "Read more".
 */
const STORY_MEDIA = { sm: "min-h-36", md: "min-h-44", lg: "min-h-52" };

/** The comps' flat bordered story card: cover, eyebrow, uppercase headline, orange meta. */
export function GhStoryCard({ story, size = "md", eyebrow = "News" }: {
  story: StoryCardType;
  size?: "sm" | "md" | "lg";
  /** null drops the label entirely — the fold's two highlights run without one. */
  eyebrow?: string | null;
}) {
  const img = mediaUrl(story.cover_path);
  return (
    <Panel className="group flex h-full flex-col overflow-hidden">
      <Link href={`/news/${story.slug}`} className="flex h-full flex-col">
        <div className={`relative ${STORY_MEDIA[size]} flex-1 overflow-hidden bg-graphite/10`}>
          {img ? (
            <Image
              src={img}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 33vw"
              style={focusStyle(story.cover_focus)}
              className="object-cover transition duration-500 group-hover:scale-[1.03]"
              unoptimized
            />
          ) : (
            PLACEHOLDER
          )}
          {story.is_member_news && <MemberBadge />}
        </div>
        <div className="shrink-0 p-4">
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {/* At lg the headline is clamped AND floored to two lines. Both are
              needed: the cover above it is a flex-1 child, so a one-line title
              beside a two-line one would give its card a taller image and the
              two cards' photo bottoms would stop lining up. 2.3em = two lines
              at CardTitle's 1.15 leading. */}
          <CardTitle className={`group-hover:underline ${eyebrow ? "mt-1.5" : ""} ${size === "lg" ? "min-h-[2.3em] text-xl line-clamp-2" : "text-[0.9375rem] line-clamp-3"}`}>
            {story.title}
          </CardTitle>
          {story.excerpt && size !== "sm" && (
            <p className="mt-2 text-sm leading-relaxed text-graphite line-clamp-2">{story.excerpt}</p>
          )}
          {/* Date and link share one line — a separate right-aligned row below
              the meta was the single biggest source of dead space in the fold. */}
          <div className="mt-2 flex items-center justify-between gap-3">
            <Meta date={story.published_at} />
            <span className="shrink-0 text-xs font-bold text-brand-text">
              Read more <span aria-hidden="true">→</span>
            </span>
          </div>
        </div>
      </Link>
    </Panel>
  );
}

/** Video card — same shell, play glyph over the still. */
export function GhVideoCard({ video, eyebrow = "Videos" }: { video: VideoCardData; eyebrow?: string }) {
  const yt = youtubeId(video.url);
  const img = mediaUrl(video.thumbnail_path ?? null) ?? (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null);
  return (
    <Panel className="group flex h-full flex-col overflow-hidden">
      <Link href={`/video/${video.slug}`} className="flex h-full flex-col">
        <div className="relative min-h-36 flex-1 overflow-hidden bg-ink">
          {img && (
            <Image src={img} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover opacity-85 transition duration-500 group-hover:scale-[1.03]" unoptimized />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/80 text-lg text-white">
              <span aria-hidden="true">▶</span>
            </span>
          </span>
          {video.source === "member" && <MemberBadge label="Member video" />}
        </div>
        <div className="shrink-0 p-4">
          <Eyebrow>{eyebrow}</Eyebrow>
          <CardTitle className="mt-1.5 text-[0.9375rem] line-clamp-3 group-hover:underline">{video.title}</CardTitle>
          {video.member && <p className="mt-2 text-xs text-graphite">{video.member.name}</p>}
        </div>
      </Link>
    </Panel>
  );
}

/** Featured machine — a sold placement, so it keeps an explicit label. */
export function GhMachineCard({ machine }: { machine: MachineCardData }) {
  return (
    <Panel className="group flex h-full flex-col overflow-hidden">
      <Link href="/featured-machine" className="flex h-full flex-col">
        <div className="relative min-h-32 flex-1 overflow-hidden bg-graphite/10">
          {machine.image_path && (
            <Image src={mediaUrl(machine.image_path)!} alt="" fill sizes="25vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" unoptimized />
          )}
        </div>
        <div className="p-4">
          <Eyebrow>Featured machine</Eyebrow>
          <CardTitle className="mt-1.5 text-sm line-clamp-2 group-hover:underline">{machine.name}</CardTitle>
          {machine.member && <p className="mt-1.5 text-xs text-graphite">{machine.member.name}</p>}
        </div>
      </Link>
    </Panel>
  );
}

export type GhEventData = {
  slug: string;
  title: string;
  location: string | null;
  starts_on: string;
  cover_path?: string | null;
};

/**
 * The next upcoming event, as the fold's second placement card.
 *
 * Note this is EDITORIAL, not a sold slot: `placement_kind` has no
 * `featured_event` member (supabase/migrations/20260808000002_commerce.sql), so
 * there is nothing to book against it. It shows whatever `upcomingEvents()`
 * returns first. The wireframe labels the position "Advert — Featured Event";
 * making that real needs a new placement kind, which is a schema change.
 */
export function GhEventCard({ event }: { event: GhEventData }) {
  const img = mediaUrl(event.cover_path ?? null);
  // starts_on is a date column, not a timestamp — format in UTC or it shifts a
  // day back west of Greenwich (same rule as components/cards.tsx:117).
  const date = new Date(event.starts_on).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return (
    <Panel className="group flex h-full flex-col overflow-hidden">
      <Link href={`/event/${event.slug}`} className="flex h-full flex-col">
        <div className="relative min-h-32 flex-1 overflow-hidden bg-graphite/10">
          {img ? (
            <Image src={img} alt="" fill sizes="25vw" className="object-cover transition duration-500 group-hover:scale-[1.03]" unoptimized />
          ) : (
            PLACEHOLDER
          )}
        </div>
        <div className="p-4">
          <Eyebrow>Featured event</Eyebrow>
          <CardTitle className="mt-1.5 text-sm line-clamp-2 group-hover:underline">{event.title}</CardTitle>
          <p className="mt-2 text-[11px] font-semibold text-brand-text">{date}</p>
          {event.location && <p className="mt-1 text-xs text-graphite line-clamp-1">{event.location}</p>}
        </div>
      </Link>
    </Panel>
  );
}

/** Featured member — a sold placement, labelled as one. */
export function GhMemberCard({ member }: { member: FeaturedMemberData }) {
  return (
    <Panel className="group overflow-hidden">
      <Link href={`/member/${member.slug}`} className="block p-4">
        <Eyebrow>Featured member</Eyebrow>
        <div className="mt-3 flex items-center gap-3">
          {member.logo_path && (
            <Image src={mediaUrl(member.logo_path)!} alt="" width={44} height={44} className="shrink-0 rounded-[var(--gh-radius)]" unoptimized />
          )}
          <CardTitle className="text-sm line-clamp-2 group-hover:underline">{member.name}</CardTitle>
        </div>
        {member.description && <p className="mt-2.5 text-xs leading-relaxed text-graphite line-clamp-3">{member.description}</p>}
      </Link>
    </Panel>
  );
}

/** Comp v2's member-news row: square thumbnail left, byline and date right. */
export function GhMemberRow({ story }: { story: StoryCardType }) {
  const img = mediaUrl(story.cover_path);
  return (
    <Link href={`/news/${story.slug}`} className="group flex gap-4">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[var(--gh-radius)] bg-graphite/10 sm:h-24 sm:w-24">
        {img ? (
          <Image src={img} alt="" fill sizes="96px" style={focusStyle(story.cover_focus)} className="object-cover" unoptimized />
        ) : (
          PLACEHOLDER
        )}
      </div>
      <div className="min-w-0">
        <CardTitle className="text-sm line-clamp-2 group-hover:underline">{story.title}</CardTitle>
        <Meta className="mt-2" date={story.published_at} by={story.member?.name} />
        {story.excerpt && <p className="mt-2 text-xs leading-relaxed text-graphite line-clamp-2">{story.excerpt}</p>}
      </div>
    </Link>
  );
}

/**
 * Comp v2's "MORE NEWS" block, as a horizontal carousel.
 *
 * Uses the shared `.carousel` class from globals.css (scroll-snap + a thin
 * scrollbar), the same mechanism the forge design's rows use — so this scrolls
 * natively with no JS, no timer and no library. Deliberately not auto-advancing:
 * the one rotating surface this site has, HomeHero, carries a standing
 * instruction never to rotate on its own, and there is no reason for this one
 * to behave differently.
 */
export function GhMoreNews({ stories }: { stories: StoryCardType[] }) {
  if (stories.length === 0) return null;
  return (
    /* h-full, not a fixed height: the carousel shares a grid row with the
       placement column beside it, so letting the tiles fill whatever the row
       ends up being keeps their bottoms flush with it without tuning a magic
       number. All tiles stay equal height, and hover only changes width — the
       row never jumps. */
    <ul className="carousel flex h-full gap-3 overflow-x-auto pb-1.5">
      {stories.map((s) => {
        const img = mediaUrl(s.cover_path);
        return (
          /*
           * Fixed height, elastic width. Resting state is a plain bordered
           * headline tile; hovering (or tabbing to it) widens the tile and
           * fades its cover in behind a scrim, so the row keeps one baseline
           * and only the focused card gets the picture.
           *
           * focus-within matters as much as hover here — without it the card
           * is a mouse-only affordance and a keyboard reader never sees the
           * expanded state. motion-reduce drops the easing, not the widening:
           * the layout change is the feature, the sliding is the decoration.
           */
          <li
            key={s.id}
            className="gh-tile group relative h-full min-h-28 w-52 flex-none overflow-hidden rounded-[var(--gh-radius)] border border-line transition-[width] duration-300 ease-out hover:w-80 focus-within:w-80 motion-reduce:transition-none"
          >
            <Link href={`/news/${s.slug}`} className="block h-full">
              {img && (
                <Image
                  src={img}
                  alt=""
                  fill
                  sizes="320px"
                  style={focusStyle(s.cover_focus)}
                  className="object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
                  unoptimized
                />
              )}
              {/*
               * Readability layer. Three things at once, and each earns its place:
               *   · a BOTTOM-WEIGHTED gradient, not a flat wash — 94% dark under
               *     the text, 12% at the top, so the photo still reads as a photo
               *     while the type sits on near-solid ground. Same shape as
               *     .hero-scrim in globals.css.
               *   · a small backdrop blur, which kills the high-frequency detail
               *     that makes white type fizz over busy machine-shop covers. It
               *     lets the gradient stay lighter than it otherwise could.
               *   · the fixed near-black is deliberately NOT a token: a scrim
               *     that moves with the palette needs its contrast re-checked
               *     every time a token moves. White on this stays ≥12:1 at the
               *     text end regardless.
               * Where backdrop-filter is unsupported this degrades to the plain
               * gradient, which is still legible. Only paints once the cover has
               * faded in, so the resting tile keeps its white ground.
               */}
              {img && (
                /* Gradient scrim only — no backdrop blur. The headline's own
                   text-shadow carries the contrast, and blurring the cover
                   softened the picture the hover exists to reveal. */
                <div className="absolute inset-0 bg-gradient-to-t from-[rgb(6_9_15/0.94)] via-[rgb(6_9_15/0.58)] to-[rgb(6_9_15/0.12)] opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none" />
              )}
              <div className="relative flex h-full flex-col justify-between gap-2 p-3">
                <div className="min-h-0">
                  {/* Member news is marked wherever it sits among industry news
                      — a commercial rule, not a style choice. The shared badge,
                      so the wording can't drift. Its ink pill melts into the
                      scrim on hover, but the white label stays 21:1 either way.
                      Clamped to two lines here (not three) to leave room for it
                      without the tile's fixed height clipping the date. */}
                  {s.is_member_news && <div className="mb-1.5"><MemberBadge variant="inline" /></div>}
                  <CardTitle className={`gh-tile-text text-[0.8125rem] line-clamp-2 ${img ? "group-hover:text-white group-focus-within:text-white" : "group-hover:underline"}`}>
                    {s.title}
                  </CardTitle>
                </div>
                {/* No gh-tile-text here — the shadow is for the headline only. */}
                <Meta
                  date={s.published_at}
                  className={img ? "group-hover:text-white group-focus-within:text-white" : ""}
                />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export type LatestItem = { eyebrow: string; label: string; href: string };

/**
 * Comp v2's mixed list beside the lead story — one row per content kind
 * (latest news, upcoming event, new video, newsletter, featured member),
 * hairline-separated. Rows are supplied already resolved by the page, so a
 * kind with nothing to show simply isn't passed.
 */
export function GhLatestList({ items, title = "In brief" }: { items: LatestItem[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <Panel className="p-4">
      <Chip>{title}</Chip>
      <ul className="mt-3 divide-y divide-line">
        {items.map((item) => (
          <li key={`${item.eyebrow}-${item.href}`} className="py-3 first:pt-0 last:pb-0">
            <Link href={item.href} className="group block">
              <Eyebrow>{item.eyebrow}</Eyebrow>
              <CardTitle className="mt-1 text-[0.8125rem] line-clamp-2 group-hover:underline">{item.label}</CardTitle>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * Comp v1's grey logo band. A parallel of components/AdSlot.tsx's
 * SupplierLogos, restyled for this page — the shared one keeps its white
 * ground for forge. Order is the rotation's, used as given: never sorted,
 * filtered or weighted (lib/adverts.ts:5-11).
 */
export function GhLogoBand({ adverts, showPlaceholders = false }: { adverts: LiveAdvert[]; showPlaceholders?: boolean }) {
  if (adverts.length === 0 && !showPlaceholders) return null;
  return (
    <Band tone="grey" inner="py-8 text-center">
      <h2 className="font-heading text-xl font-extrabold">Brands who advertise with us</h2>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {adverts.length > 0
          ? adverts.map((ad) => (
              <Link key={ad.advertId} href={advertHref(ad)}>
                <Image src={mediaUrl(ad.mobilePath)!} alt={ad.name} width={120} height={60} className="h-10 w-auto" unoptimized />
              </Link>
            ))
          : Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="flex h-10 w-28 items-center justify-center rounded-[var(--gh-radius)] border-2 border-dashed border-graphite/40 bg-graphite/5 text-[11px] font-bold uppercase tracking-widest text-graphite"
              >
                Logo
              </div>
            ))}
      </div>
    </Band>
  );
}

/** Comp v2's orange newsletter panel. Ink on orange throughout — never white. */
export function GhNewsletterPanel() {
  return (
    <div className="flex h-full flex-col justify-center rounded-[var(--gh-radius)] bg-brand p-6 text-ink">
      <h2 className="font-heading text-xl font-extrabold">Get the SMI newsletter</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink/80">
        UK sheet metal manufacturing news, machinery launches and event dates, for free.
      </p>
      {/* tone="dark": the default orange button would vanish on this panel. */}
      <div className="mt-4">
        <NewsletterSignup tone="dark" />
      </div>
    </div>
  );
}

/**
 * Social reach has no source in the database — the other two figures are real
 * (published stories and active members, both already loaded for this page).
 * Logged for Jas to confirm or drop in docs/HUMAN-TODO.md; the comp's number.
 */
const SOCIAL_REACH = 347_000;

/** Comp v1's near-black stats band, closing the page above the footer. */
export async function GhStatsBand({ storyTotal, memberCount }: { storyTotal: number; memberCount: number }) {
  // Same rule as JoinCta: signed-in visitors have already joined, so they get
  // the numbers without the pitch.
  const signedIn = Boolean(await currentUser());
  const stats = [
    { label: "Relevant, up-to-date news", value: storyTotal, caption: "Published articles" },
    { label: "Grow your connections", value: memberCount, caption: "Member companies" },
    { label: "Promote your business", value: SOCIAL_REACH, caption: "Social media reach" },
  ];
  return (
    <Band tone="dark" inner="py-12 text-center">
      <h2 className="font-heading text-2xl font-extrabold">Brand awareness that reaches the right buyers</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-white/70">
        SMI publishes the UK sheet metal trade&apos;s news, and helps the companies in it promote their
        strengths, products and services to the people specifying and buying equipment.
      </p>
      <dl className="mx-auto mt-10 grid max-w-3xl gap-8 sm:grid-cols-3">
        {/* Each div holds exactly one dt then one dd — axe's definition-list
            rule rejects any other direct child, so the caption lives inside
            the dd rather than as a sibling <p>. */}
        {stats.map((s) => (
          <div key={s.caption}>
            <dt className="text-sm font-bold">{s.label}</dt>
            <dd className="mt-2">
              {/* Orange on near-black is 7.4:1 — the pairing that passes. */}
              <span className="block font-heading text-4xl font-extrabold text-brand">{s.value.toLocaleString("en-GB")}</span>
              <span className="mt-1 block text-xs text-white/60">{s.caption}</span>
            </dd>
          </div>
        ))}
      </dl>
      {!signedIn && (
        <div className="mt-10">
          <BtnBrand href="/join">Sign up for membership</BtnBrand>
        </div>
      )}
    </Band>
  );
}

/** Comp v2's magazine promo — the one editorial block with a dark button. */
export function GhPublicationPanel() {
  return (
    <Panel className="flex h-full flex-col p-5 text-center">
      <Eyebrow>Publication</Eyebrow>
      <h2 className="mt-1.5 font-heading text-lg font-extrabold uppercase leading-tight">
        Sheet Metal Industries MACH Special
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-graphite">
        Our special edition for MACH 2026 — the machines, the makers and the stands worth your time.
      </p>
      <div className="mt-auto pt-5">
        <BtnDark href="/pages/mach-publication">Read more</BtnDark>
      </div>
    </Panel>
  );
}
