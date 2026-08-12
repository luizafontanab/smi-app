import Image from "next/image";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { publishedVideos } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";

export const dynamic = "force-dynamic";
export const metadata = { title: "Videos" };

export default async function VideosPage() {
  const [videos, banners, showPlaceholders, ctx] = await Promise.all([
    publishedVideos(24),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["videos_mid"]);
  record([{ kind: "page_view", path: "/videos", ...ctx }]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Videos</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {videos.slice(0, 6).map((v) => <VideoCard key={v.id} video={v} />)}
      </div>
      {/* Mid-page banner, same placement rule as the newsroom: below the first two
          rows, never above the content readers came for. Rendered unconditionally —
          the slot is booked inventory, so it must not vanish on a short listing. */}
      <div className="my-6"><AdSlot slotKey="videos_mid" adverts={slots.get("videos_mid") ?? []} showPlaceholders={showPlaceholders} /></div>
      {videos.length > 6 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.slice(6).map((v) => <VideoCard key={v.id} video={v} />)}
        </div>
      )}
      <div className="my-10" />
    </div>
  );
}

function VideoCard({ video }: { video: { id: string; title: string; url: string; member?: { name: string } | null } }) {
  const yt = video.url.match(/[?&]v=([\w-]+)/)?.[1];
  return (
    <a href={video.url} target="_blank" rel="noopener" className="group overflow-hidden rounded-lg bg-white shadow-sm hover:shadow-md">
      <div className="relative h-44 bg-navy">
        {yt && <Image src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="" fill sizes="33vw" className="object-cover opacity-80" unoptimized />}
        <span className="absolute inset-0 flex items-center justify-center text-4xl text-white drop-shadow">▶</span>
      </div>
      <div className="p-3">
        <p className="font-semibold line-clamp-2">{video.title}</p>
        {video.member && <p className="mt-1 text-xs text-gray-500">{video.member.name}</p>}
      </div>
    </a>
  );
}
