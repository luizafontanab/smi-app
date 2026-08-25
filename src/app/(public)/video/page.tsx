import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { publishedVideos } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { VideoCard } from "@/components/cards";

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
  record([{ kind: "page_view", path: "/video", ...ctx }]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Videos</h1>
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
