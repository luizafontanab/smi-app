import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { breadcrumbLd, newsArticleLd } from "@/lib/jsonld";
import { storyBySlug } from "@/lib/queries";
import { loadStoryPageData } from "@/lib/story-page";
import { JsonLd } from "@/components/JsonLd";
import { StoryPageView } from "@/components/story/StoryPageView";
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
  const [story, ctx] = await Promise.all([storyBySlug(slug), requestContext()]);
  if (!story) notFound();

  const path = `/news/${slug}`;
  const data = await loadStoryPageData(story);
  // impressions come from the browser once seen — see AdCreative / /api/seen
  record([{ kind: "story_view", story_id: story.id, member_id: story.member_id, path, ...ctx }]);

  const cover = mediaUrl(story.cover_path);
  const cats = (story.categories ?? []).map((c) => c.category).filter(Boolean) as { slug: string; name: string }[];

  return (
    // Wider from lg so the article and its member sidebar fill the screen (Jas 13/10 item 13).
    <div className="mx-auto max-w-4xl px-4 lg:max-w-6xl">
      {/* Notes this story's category + author-industry slugs in the viewed_cats
          cookie (consent-gated client-side) — feeds /news's "For you" rail. */}
      <RecordViewed slugs={[...cats.map((c) => c.slug), ...(data.industrySlug ? [data.industrySlug] : [])]} />
      <JsonLd
        data={[
          newsArticleLd({ ...story, coverUrl: cover }),
          breadcrumbLd([
            { name: "News", path: "/news" },
            { name: story.title, path },
          ]),
        ]}
      />
      <StoryPageView story={story} categories={cats} cover={cover} members={data.members} socialPosts={story.social_posts} data={data} path={path} />
    </div>
  );
}
