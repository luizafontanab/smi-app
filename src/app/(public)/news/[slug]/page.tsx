import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys, bodyAdSlotKeys } from "@/lib/blocks/schema";
import { mediaUrl } from "@/lib/db/server";
import { focusStyle } from "@/lib/focus";
import { breadcrumbLd, newsArticleLd } from "@/lib/jsonld";
import { isMemberLinkable } from "@/lib/member-visibility";
import { storyBySlug, publishedStories, storyIndustrySlug } from "@/lib/queries";
import { splitAtAdBreaks } from "@/lib/sanitize";
import { AdSlot } from "@/components/AdSlot";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { JsonLd } from "@/components/JsonLd";
import { MemberBacklink } from "@/components/MemberBacklink";
import { ShareButtons } from "@/components/ShareButtons";
import { StoryBody } from "@/components/StoryBody";
import { MemberBadge } from "@/components/StoryCard";
import { RecordViewed } from "../RecordViewed";

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
  // Banners and the placeholder flag don't depend on the layout, so they join
  // the first round instead of waiting behind getLayout — only the two
  // layout-conditional fetches stay in round two.
  const [story, ctx, banners, showPlaceholders] = await Promise.all([
    storyBySlug(slug),
    requestContext(),
    liveAdverts("banner"),
    showAdPlaceholders(),
  ]);
  if (!story) notFound();

  const layout = await getLayout("story", story.id);
  const wantsLatest = layout.blocks.some((b) => b.type === "latest_news");
  const [{ stories: more }, logos, industrySlug] = await Promise.all([
    wantsLatest ? publishedStories({ limit: 5 }) : Promise.resolve({ stories: [] }),
    layout.blocks.some((b) => b.type === "supplier_logos") ? liveAdverts("supplier_logo") : Promise.resolve([]),
    // the story's own industry, for the viewed_cats cookie mount below
    storyIndustrySlug(story.id),
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
      {/* Notes this story's category + author-industry slugs in the viewed_cats
          cookie (consent-gated client-side) — feeds /news's "For you" rail. */}
      <RecordViewed slugs={[...cats.map((c) => c.slug), ...(industrySlug ? [industrySlug] : [])]} />
      <JsonLd
        data={[
          newsArticleLd({ ...story, coverUrl: cover }),
          breadcrumbLd([
            { name: "News", path: "/news" },
            { name: story.title, path: `/news/${slug}` },
          ]),
        ]}
      />
      <BlockRenderer
        pageType="story"
        layout={layout}
        slots={slots}
        latestStories={more.filter((s) => s.slug !== slug).slice(0, 4)}
        memberStories={[]}
        supplierLogos={logos}
        showPlaceholders={showPlaceholders}
        path={`/news/${slug}`}
        anchors={{
          story_header: (
            <header className="mt-4">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {story.is_member_news && <MemberBadge variant="inline" />}
                {cats.map((c) => (
                  <Link key={c.slug} href={`/news?category=${c.slug}`} className="rounded-full bg-graphite/10 px-3 py-1 text-graphite hover:bg-graphite/20">{c.name}</Link>
                ))}
              </div>
              <h1 className="mt-3 text-3xl font-bold leading-tight text-ink">{story.title}</h1>
              <p className="mt-2 text-sm text-graphite">
                Sheet Metal Industries
                {story.published_at && ` · ${new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
              </p>
            </header>
          ),
          story_hero: cover && (
            <div className="relative mt-4 h-96 overflow-hidden rounded-lg">
              <Image src={cover} alt="" fill sizes="100vw" style={focusStyle(story.cover_focus)} className="object-cover" preload unoptimized />
            </div>
          ),
          story_body: (
            <article className="story-read">
              <StoryBody
                segments={segments}
                className="mt-6"
                breaks={bodyKeys.map((key) => {
                  const ads = slots.get(key) ?? [];
                  // same rule as BlockRenderer's ad_banner: the margin-carrying
                  // wrapper must not render around an empty slot
                  return ads.length || showPlaceholders
                    ? <div className="my-8"><AdSlot adverts={ads} slotKey={key} showPlaceholders={showPlaceholders} path={`/news/${slug}`} /></div>
                    : null;
                })}
              />
              <ShareButtons />
              {/* Member backlink + footer branding — the fixed "minor tweak" (req 02/07).
                  Gated by the one shared rule (lib/member-visibility.ts): a lapsed member's
                  page 404s and an archived member's is admin-only, so linking there for
                  anyone else would be a dead link. STORY_CARD is a publicDb read, so RLS
                  has already nulled the embed for an archived member — the status check
                  here is what catches lapsed. */}
              {isMemberLinkable(story.member) && (
                <MemberBacklink name={story.member.name} slug={story.member.slug} logoUrl={mediaUrl(story.member.logo_path)} />
              )}
            </article>
          ),
        }}
      />
    </div>
  );
}
