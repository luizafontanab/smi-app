import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import type { StoryCard as StoryCardType } from "@/lib/queries";

// MemberBadge moved to its own module so client components (the member's
// story preview) can use it — this file imports the server-only db client.
import { MemberBadge } from "@/components/MemberBadge";
export { MemberBadge };

export function StoryCard({
  story, size = "md", showExcerpt = true,
}: {
  story: StoryCardType;
  size?: "md" | "lg" | "sm";
  /** Off on the news page (fix list) — image, title and date only, no summary text. */
  showExcerpt?: boolean;
}) {
  const img = mediaUrl(story.cover_path);
  // 16:9 boxes rather than fixed heights for the card sizes (#33 E10): about
  // two-thirds of covers are ~16:9 (measured on /news), often with lettering in
  // the artwork, and a 256×176 crop cut the words off at both sides. Near the
  // old heights at desktop widths (a 360px grid card is ~200px tall, was 176).
  const heights = { sm: "aspect-video", md: "aspect-video", lg: "h-80" };
  return (
    <Link href={`/news/${story.slug}`} data-part="story-card" className="group block overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md">
      {/* overflow-hidden clips the crop zoom (and the hover grow) to the media
          box — without it a zoomed cover spills over the headline below. */}
      <div data-part="card-image" className={`relative ${heights[size]} overflow-hidden bg-graphite/10`}>
        {img ? (
          <Image src={img} alt="" fill sizes={size === "lg" ? "100vw" : "(max-width: 768px) 100vw, 33vw"} style={focusStyle(story.cover_focus)} className="object-cover transition group-hover:scale-[1.02]" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-graphite/30">⚙</div>
        )}
        {story.is_member_news && <MemberBadge />}
      </div>
      {/* Phone sizes step up (#33 C4): a full-width card on a phone set its
          title at 14px and its date at 11px. From sm the denser desktop
          sizes return. */}
      <div data-part="card-body" className="p-3">
        <h3 data-part="card-title" className={`font-semibold leading-snug ${size === "lg" ? "text-2xl" : "text-base sm:text-sm"} line-clamp-3`}>{story.title}</h3>
        {showExcerpt && size !== "sm" && story.excerpt && <p data-part="card-excerpt" className="mt-1 text-sm text-graphite line-clamp-2 sm:text-xs">{story.excerpt}</p>}
        <p data-part="card-meta" className="mt-2 text-xs uppercase tracking-wide text-graphite sm:text-[11px]">
          {story.published_at ? new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : ""}
          {story.member && <> · {story.member.name}</>}
        </p>
      </div>
    </Link>
  );
}

export function Carousel({ title, children, href, linkLabel = "See all →" }: { title: string; children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <section data-part="section" className="mt-8">
      <div data-part="section-head" className="mb-3 flex items-baseline justify-between">
        <h2 data-part="section-title" className="text-lg font-bold uppercase tracking-wide text-ink">{title}</h2>
        {href && <Link href={href} data-part="see-all" className="text-sm text-graphite hover:underline">{linkLabel}</Link>}
      </div>
      <div data-part="carousel" className="carousel flex gap-4 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}
