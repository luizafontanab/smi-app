import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { headlineVideo, publishedVideos } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { Pagination } from "@/components/Pagination";
import { SearchForm } from "@/components/SearchForm";
import { VideoCard } from "@/components/cards";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export const metadata = {
  title: "Videos",
  description: "Watch the UK sheet metal trade at work: machinery demonstrations, factory tours and member videos from SMI.",
  alternates: { canonical: "/video" },
};

export default async function VideosPage(props: PageProps<"/video">) {
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ videos, total }, headline, banners, showPlaceholders, ctx] = await Promise.all([
    publishedVideos({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    page === 1 ? headlineVideo() : Promise.resolve(null),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["videos_mid"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  record([{ kind: "page_view", path: "/video", ...ctx }]);

  const qs = (p: number) => (p > 1 ? `/video?page=${p}` : "/video");
  // exclude the featured video from the grid below so a pin never shows twice
  const gridVideos = headline ? videos.filter((v) => v.id !== headline.id) : videos;

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Videos</h1>
      <SearchForm className="mt-4 flex gap-2" />
      {headline && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-widest text-graphite">Featured</p>
          <div className="mt-2 max-w-sm">
            <VideoCard video={headline} />
          </div>
        </div>
      )}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gridVideos.slice(0, 6).map((v) => <VideoCard key={v.id} video={v} />)}
      </div>
      {/* Mid-page banner, same placement rule as the newsroom: below the first two
          rows, never above the content readers came for. Rendered unconditionally —
          the slot is booked inventory, so it must not vanish on a short listing. */}
      <div className="my-6"><AdSlot slotKey="videos_mid" adverts={slots.get("videos_mid") ?? []} showPlaceholders={showPlaceholders} path="/video" /></div>
      {gridVideos.length > 6 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gridVideos.slice(6).map((v) => <VideoCard key={v.id} video={v} />)}
        </div>
      )}
      {videos.length === 0 && <p className="mt-10 text-center text-graphite">No videos found.</p>}
      <Pagination page={page} pages={pages} hrefFor={qs} />
      <div className="my-10" />
    </div>
  );
}
