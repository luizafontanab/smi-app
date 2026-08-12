import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { getLayout } from "@/lib/blocks/layouts";
import { adSlotKeys } from "@/lib/blocks/schema";
import { mediaUrl } from "@/lib/db/server";
import { storyBySlug, publishedStories } from "@/lib/queries";
import { BlockRenderer } from "@/components/blocks/BlockRenderer";
import { MemberBacklink } from "@/components/MemberBacklink";
import { RichText } from "@/components/RichText";
import { ShareButtons } from "@/components/ShareButtons";
import { MemberBadge } from "@/components/StoryCard";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/news/[slug]">) {
  const { slug } = await props.params;
  const story = await storyBySlug(slug);
  return { title: story?.title ?? "Story", description: story?.excerpt ?? undefined };
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

  const slots = dealSlots(banners, adSlotKeys("story", layout));
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
              <RichText html={story.body} className="mt-6" />
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
