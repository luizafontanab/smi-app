import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import type { StoryCard as StoryCardType } from "@/lib/queries";

// Dark ground, white text: the badge sits over photography at small sizes, so
// it needs the highest-contrast pairing available rather than the accent — on
// the client's orange, white would be ~3.3:1, below AA at this size.
// "inline" drops the overlay positioning so the badge can sit in a row of
// pills (story page header).
export function MemberBadge({ variant = "overlay" }: { variant?: "overlay" | "inline" }) {
  const base = "bg-ink text-[11px] font-bold uppercase tracking-wide text-white";
  return variant === "inline" ? (
    <span className={`rounded-full px-3 py-1 ${base}`}>Member news</span>
  ) : (
    <span className={`absolute left-2 top-2 z-10 rounded px-2 py-0.5 ${base}`}>Member news</span>
  );
}

export function StoryCard({ story, size = "md" }: { story: StoryCardType; size?: "md" | "lg" | "sm" }) {
  const img = mediaUrl(story.cover_path);
  const heights = { sm: "h-32", md: "h-44", lg: "h-80" };
  return (
    <Link href={`/news/${story.slug}`} className="group block overflow-hidden rounded-lg bg-white shadow-sm transition hover:shadow-md">
      {/* overflow-hidden clips the crop zoom (and the hover grow) to the media
          box — without it a zoomed cover spills over the headline below. */}
      <div className={`relative ${heights[size]} overflow-hidden bg-graphite/10`}>
        {img ? (
          <Image src={img} alt="" fill sizes={size === "lg" ? "100vw" : "(max-width: 768px) 100vw, 33vw"} style={focusStyle(story.cover_focus)} className="object-cover transition group-hover:scale-[1.02]" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl text-graphite/30">⚙</div>
        )}
        {story.is_member_news && <MemberBadge />}
      </div>
      <div className="p-3">
        <h3 className={`font-semibold leading-snug ${size === "lg" ? "text-2xl" : "text-sm"} line-clamp-3`}>{story.title}</h3>
        {size !== "sm" && story.excerpt && <p className="mt-1 text-xs text-gray-500 line-clamp-2">{story.excerpt}</p>}
        <p className="mt-2 text-[11px] uppercase tracking-wide text-gray-500">
          {story.published_at ? new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : ""}
          {story.member && <> · {story.member.name}</>}
        </p>
      </div>
    </Link>
  );
}

export function Carousel({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-bold uppercase tracking-wide text-ink">{title}</h2>
        {href && <Link href={href} className="text-sm text-graphite hover:underline">See all →</Link>}
      </div>
      <div className="carousel flex gap-4 overflow-x-auto pb-2">{children}</div>
    </section>
  );
}
