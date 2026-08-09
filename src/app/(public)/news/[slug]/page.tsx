import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dealSlots, liveAdverts } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { storyBySlug, publishedStories } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { MemberBadge, StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/news/[slug]">) {
  const { slug } = await props.params;
  const story = await storyBySlug(slug);
  return { title: story?.title ?? "Story", description: story?.excerpt ?? undefined };
}

export default async function StoryPage(props: PageProps<"/news/[slug]">) {
  const { slug } = await props.params;
  const [story, banners, { stories: more }, ctx] = await Promise.all([
    storyBySlug(slug),
    liveAdverts("banner"),
    publishedStories({ limit: 4 }),
    requestContext(),
  ]);
  if (!story) notFound();

  const slots = dealSlots(banners, ["siderail_a", "footer"]);
  record([
    { kind: "story_view", story_id: story.id, member_id: story.member_id, path: `/news/${slug}`, ...ctx },
    ...[...slots.values()].flatMap((ads) => (ads[0] ? [{ kind: "ad_impression" as const, advert_id: ads[0].advertId, ...ctx }] : [])),
  ]);

  const cover = mediaUrl(story.cover_path);
  const cats = (story.categories ?? []).map((c) => c.category).filter(Boolean) as { slug: string; name: string }[];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <div className="mt-6 grid gap-8 lg:grid-cols-3">
        <article className="lg:col-span-2">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {cats.map((c) => (
              <Link key={c.slug} href={`/news?category=${c.slug}`} className="rounded-full bg-steel/10 px-3 py-1 text-steel hover:bg-steel/20">{c.name}</Link>
            ))}
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-navy">{story.title}</h1>
          <p className="mt-2 text-sm text-gray-500">
            {story.published_at && new Date(story.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
          {cover && (
            <div className="relative mt-4 h-96 overflow-hidden rounded-lg">
              {story.is_member_news && <MemberBadge />}
              <Image src={cover} alt="" fill sizes="100vw" className="object-cover" preload unoptimized />
            </div>
          )}
          <div className="story-body mt-6" dangerouslySetInnerHTML={{ __html: story.body }} />

          {/* Member backlink + footer branding — the fixed "minor tweak" (req 02/07) */}
          {story.member && (
            <aside className="mt-8 rounded-lg border-2 border-amber bg-amber/5 p-5">
              <div className="flex items-center gap-4">
                {story.member.logo_path && (
                  <Image src={mediaUrl(story.member.logo_path)!} alt="" width={56} height={56} className="rounded" unoptimized />
                )}
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-500">This story features an SMI member</p>
                  <Link href={`/members/${story.member.slug}`} className="text-lg font-bold text-navy hover:underline">
                    {story.member.name} →
                  </Link>
                </div>
              </div>
            </aside>
          )}
        </article>

        <aside className="flex flex-col gap-4">
          <AdSlot adverts={slots.get("siderail_a") ?? []} shape="rail" />
          <h2 className="mt-2 text-sm font-bold uppercase tracking-wide text-navy">More news</h2>
          {more.filter((s) => s.slug !== slug).slice(0, 3).map((s) => <StoryCard key={s.id} story={s} size="sm" />)}
        </aside>
      </div>
      <div className="my-8"><AdSlot adverts={slots.get("footer") ?? []} /></div>
    </div>
  );
}
