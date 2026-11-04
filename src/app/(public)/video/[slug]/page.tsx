import Link from "next/link";
import { issueFromLink, newsletterLinkParams } from "@/lib/newsletter-tracking";
import { notFound } from "next/navigation";
import { newsletterClick, record, requestContext } from "@/lib/analytics";
import { youtubeId } from "@/lib/hero";
import { breadcrumbLd, stripTags, videoLd } from "@/lib/jsonld";
import { isMemberLinkable } from "@/lib/member-visibility";
import { latestVideos, videoBySlug } from "@/lib/queries";
import { VideoCard } from "@/components/cards";
import { JsonLd } from "@/components/JsonLd";
import { RichText } from "@/components/RichText";
import { ShareButtons } from "@/components/ShareButtons";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/video/[slug]">) {
  const { slug } = await props.params;
  const video = await videoBySlug(slug);
  const title = video?.title ?? "Video";
  const description = video?.description ? stripTags(video.description).slice(0, 160) : undefined;
  // No cover uploads for videos — the YouTube thumbnail is the natural card.
  const yt = video ? youtubeId(video.url) : null;
  const thumb = yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/video/${slug}` },
    openGraph: { type: "video.other", url: `/video/${slug}`, title, description, images: thumb ? [thumb] : undefined },
    twitter: { card: "summary_large_image", title, description, images: thumb ? [thumb] : undefined },
  };
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : null;

export default async function VideoPage(props: PageProps<"/video/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  // Five latest, so four remain once this one is left out — the "More videos"
  // row below (#33 C14).
  const [video, ctx, issue, latest] = await Promise.all([
    videoBySlug(slug),
    requestContext(),
    issueFromLink(newsletterLinkParams(sp)),
    latestVideos(5),
  ]);
  if (!video) notFound();
  const more = latest.filter((v) => v.id !== video.id).slice(0, 4);
  // The newsletter issue rides on the page_view only, so a video counts once in the issue's report.
  // From a newsletter link it counts without consent too, anonymously (lib/analytics newsletterClick).
  record([{ kind: "page_view", path: `/video/${slug}`, newsletter_issue_id: issue?.id ?? null, ...newsletterClick(ctx, newsletterLinkParams(sp).src) }]);
  // Content reach (GAPS A9.2): the member's own view count for this video.
  // Only for member videos — an editorial video has nobody to credit. A
  // SEPARATE call on purpose: record() inserts its batch as one statement, so
  // if this kind were ever rejected (a deploy ahead of 20260928000003) it
  // would take the site-wide page_view above down with it.
  if (video.member_id) record([{ ...ctx, kind: "video_view", path: `/video/${slug}`, member_id: video.member_id }]);

  const yt = youtubeId(video.url);
  const published = fmt(video.published_at);
  // One shared rule for the byline (lib/member-visibility.ts). videoBySlug is a
  // publicDb read whose projection carries neither `status` nor `archived_at`,
  // so RLS has already nulled the embed for a member who should not be credited
  // — this resolves to the null check, with the policy as the enforcement point.
  const byline = isMemberLinkable(video.member) ? video.member : null;

  return (
    <div className="mx-auto max-w-4xl px-4">
      <JsonLd
        data={[
          videoLd({ ...video, youtubeId: yt }),
          breadcrumbLd([
            { name: "Videos", path: "/video" },
            { name: video.title, path: `/video/${slug}` },
          ]),
        ]}
      />
      {/* tap: a 20px-tall text link was the only way back on a phone (#33 C16) */}
      <div className="mt-6">
        <Link href="/video" className="tap text-sm text-graphite hover:text-ink">← All videos</Link>
      </div>

      {/* youtube-nocookie so an embed does not set advertising cookies before the
          visitor has answered the consent banner. frame-src in next.config.ts
          allows www.youtube.com; the nocookie host needs adding there too. */}
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg bg-ink">
        {yt ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        ) : (
          <a href={video.url} target="_blank" rel="noopener" className="flex h-full w-full items-center justify-center text-white underline">
            Watch this video →
          </a>
        )}
      </div>

      <h1 className="mt-6 text-2xl font-bold text-ink">{video.title}</h1>
      <p className="mt-1 text-sm text-graphite">
        {byline && (
          <>
            Posted by <Link href={`/member/${byline.slug}`} className="text-graphite underline">{byline.name}</Link>
          </>
        )}
        {byline && published && " · "}
        {published}
      </p>

      {video.description && <RichText html={video.description} className="mt-4 text-ink" />}

      <ShareButtons />

      {/* The page used to end at the share buttons and run straight into the
          footer — a dead end on a phone (#33 C14). Two cards below sm, so the
          row doesn't become a second page of its own. */}
      {more.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-bold uppercase tracking-wide text-ink">More videos</h2>
            <Link href="/video" className="tap text-sm text-graphite hover:underline">See all →</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {more.map((v, i) => (
              <div key={v.id} className={i >= 2 ? "hidden sm:block" : undefined}>
                <VideoCard video={v} />
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="my-10" />
    </div>
  );
}
