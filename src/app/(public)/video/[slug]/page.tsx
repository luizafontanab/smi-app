import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { youtubeId } from "@/lib/hero";
import { breadcrumbLd, stripTags, videoLd } from "@/lib/jsonld";
import { videoBySlug } from "@/lib/queries";
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
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

export default async function VideoPage(props: PageProps<"/video/[slug]">) {
  const { slug } = await props.params;
  const [video, ctx] = await Promise.all([videoBySlug(slug), requestContext()]);
  if (!video) notFound();
  record([{ kind: "page_view", path: `/video/${slug}`, ...ctx }]);

  const yt = youtubeId(video.url);
  const published = fmt(video.published_at);

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
      <Link href="/video" className="mt-6 inline-block text-sm text-graphite hover:text-ink">← All videos</Link>

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
        {video.member && (
          <>
            Posted by <Link href={`/member/${video.member.slug}`} className="text-graphite underline">{video.member.name}</Link>
          </>
        )}
        {video.member && published && " · "}
        {published}
      </p>

      {video.description && <RichText html={video.description} className="mt-4 text-ink" />}

      <ShareButtons />
      <div className="my-10" />
    </div>
  );
}
