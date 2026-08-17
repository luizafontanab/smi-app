import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys, bodyAdSlotKeys } from "@/lib/blocks/schema";
import { mediaUrl } from "@/lib/db/server";
import { storyBySlug, publishedStories } from "@/lib/queries";
import { splitAtAdBreaks } from "@/lib/sanitize";
import { AdSlot } from "@/components/AdSlot";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { MemberBacklink } from "@/components/MemberBacklink";
import { ShareButtons } from "@/components/ShareButtons";
import { StoryBody } from "@/components/StoryBody";
import { MemberBadge } from "@/components/StoryCard";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/news/[slug]">) {
  const { slug } = await props.params;
  const story = await storyBySlug(slug);
  const title = story?.title ?? "Story";
  const description = story?.excerpt ?? undefined;
  const cover = mediaUrl(story?.cover_path);
  // Stories are distributed by sharing (see ShareButtons), so the card a
  // scraper renders is the story's shop window — without these it fell back to
  // the site-wide description and no image at all.
  return {
    title,
    description,
    alternates: { canonical: `/news/${slug}` },
    openGraph: {
      type: "article",
      url: `/news/${slug}`,
      title,
      description,
      publishedTime: story?.published_at ?? undefined,
      images: cover ? [cover] : undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: cover ? [cover] : undefined },
  };
}

export default async function StoryPage(props: PageProps<"/news/[slug]">) {
  const { slug } = await props.params;
  const [story, ctx] = await Promise.all([storyBySlug(slug), requestContext()]);
  if (!story) notFound();

  const layout = await getLayout("story", story.id);
  const wantsLatest = layout.blocks.some((b) => b.type === "latest_news");
  const [banners, { stories: more }, logos, showPlaceholders] = await Promise.all([
    liveAdverts("banner"),
    wantsLatest ? publishedStories({ limit: 5 }) : Promise.resolve({ stories: [] }),
    layout.blocks.some((b) => b.type === "supplier_logos") ? liveAdverts("supplier_logo") : Promise.resolve([]),
    showAdPlaceholders(),
  ]);

  // Split once: the segments render the body and their count is what derives the
  // in-body slot keys. Both key sets feed ONE deal, so the "no advert twice on a
  // page" guarantee spans the layout's slots and the author's breaks alike.
  const segments = splitAtAdBreaks(story.body);
  const bodyKeys = bodyAdSlotKeys(segments.length - 1);
  const slots = dealSlots(banners, [...adSlotKeys("story", layout), ...bodyKeys]);
  // impressions come from the browser once seen — see AdCreative / /api/seen
  record([{ kind: "story_view", story_id: story.id, member_id: story.member_id, path: `/news/${slug}`, ...ctx }]);

  const cover = mediaUrl(story.cover_path);
  const cats = (story.categories ?? []).map((c) => c.category).filter(Boolean) as { slug: string; name: string }[];

  // Live-site structure: single column — title/meta, ad below meta, hero, body,
  // then post-article blocks. Order comes from the (admin-arranged) layout.
  return (
    <div className="mx-auto max-w-4xl px-4">
      <BlockRenderer
        pageType="story"
        layout={layout}
        slots={slots}
        latestStories={more.filter((s) => s.slug !== slug).slice(0, 4)}
        memberStories={[]}
        supplierLogos={logos}
        showPlaceholders={showPlaceholders}
        anchors={{
          story_header: (
            <header className="mt-4">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {story.is_member_news && <MemberBadge variant="inline" />}
                {cats.map((c) => (
                  <Link key={c.slug} href={`/news?category=${c.slug}`} className="rounded-full bg-steel/10 px-3 py-1 text-steel hover:bg-steel/20">{c.name}</Link>
                ))}
              </div>
              <h1 className="mt-3 text-3xl font-bold leading-tight text-navy">{story.title}</h1>
              <p className="mt-2 text-sm text-gray-500">
                Sheet Metal Industries
                {story.published_at && ` · ${new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
              </p>
            </header>
          ),
          story_hero: cover && (
            <div className="relative mt-4 h-96 overflow-hidden rounded-lg">
              <Image src={cover} alt="" fill sizes="100vw" className="object-cover" preload unoptimized />
            </div>
          ),
          story_body: (
            <article>
              <StoryBody
                segments={segments}
                className="mt-6"
                breaks={bodyKeys.map((key) => {
                  const ads = slots.get(key) ?? [];
                  // same rule as BlockRenderer's ad_banner: the margin-carrying
                  // wrapper must not render around an empty slot
                  return ads.length || showPlaceholders
                    ? <div className="my-8"><AdSlot adverts={ads} slotKey={key} showPlaceholders={showPlaceholders} /></div>
                    : null;
                })}
              />
              <ShareButtons />
              {/* Member backlink + footer branding — the fixed "minor tweak" (req 02/07) */}
              {story.member && (
                <MemberBacklink name={story.member.name} slug={story.member.slug} logoUrl={mediaUrl(story.member.logo_path)} />
              )}
            </article>
          ),
        }}
      />
    </div>
  );
}
