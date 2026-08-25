import Link from "next/link";
import { notFound } from "next/navigation";
import { record, requestContext } from "@/lib/analytics";
import { youtubeId } from "@/lib/hero";
import { videoBySlug } from "@/lib/queries";
import { RichText } from "@/components/RichText";
import { ShareButtons } from "@/components/ShareButtons";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/video/[slug]">) {
  const { slug } = await props.params;
  const video = await videoBySlug(slug);
  return { title: video?.title ?? "Video" };
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
      <Link href="/video" className="mt-6 inline-block text-sm text-gray-400 hover:text-ink">← All videos</Link>

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
      <p className="mt-1 text-sm text-gray-500">
        {video.member && (
          <>
            Posted by <Link href={`/member/${video.member.slug}`} className="text-graphite underline">{video.member.name}</Link>
          </>
        )}
        {video.member && published && " · "}
        {published}
      </p>

      {video.description && <RichText html={video.description} className="mt-4 text-gray-700" />}

      <ShareButtons />
      <div className="my-10" />
    </div>
  );
}
