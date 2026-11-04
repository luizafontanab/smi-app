import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { headlineVideo, industries, publishedVideos } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { Pagination } from "@/components/Pagination";
import { SearchForm } from "@/components/SearchForm";
import { VideoCard } from "@/components/cards";
import { PILL, PILL_ROW } from "@/components/filter-pills";

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
  // Industries hidden from the public (flag industries_public): no pills, and
  // an old ?industry= link is ignored rather than filtering invisibly.
  const showIndustries = await isFeatureEnabled("industries_public");
  const industry = showIndustries && typeof sp.industry === "string" ? sp.industry : undefined;

  const [{ videos, total }, headline, inds, banners, showPlaceholders, ctx] = await Promise.all([
    publishedVideos({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, industry }),
    // The pin is site-wide, not per-industry, so a filtered view has no
    // headline — otherwise a Welding page would be led by someone else's video.
    page === 1 && !industry ? headlineVideo() : Promise.resolve(null),
    showIndustries ? industries() : [],
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["videos_mid"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  record([{ kind: "page_view", path: "/video", ...ctx }]);

  // One builder for both link families: changing the industry resets paging,
  // since a filtered page 3 is nonsense (same rule as /event's qs).
  const href = (over: { page?: number; industry?: string }) => {
    const params = new URLSearchParams();
    const ind = "industry" in over ? over.industry : industry;
    const p = over.page ?? ("industry" in over ? 1 : page);
    if (ind) params.set("industry", ind);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/video?${s}` : "/video";
  };
  const qs = (p: number) => href({ page: p });
  // exclude the featured video from the grid below so a pin never shows twice
  const gridVideos = headline ? videos.filter((v) => v.id !== headline.id) : videos;

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Videos</h1>
      <SearchForm className="mt-4 flex gap-2" />
      {/* Industry pills, same shape and data as the newsroom's — this is where
          /industry/[slug]'s Videos section sends its "See all". */}
      {showIndustries && (
        <nav aria-label="Filter by industry" className={`mt-4 ${PILL_ROW}`}>
          <Link href={href({ industry: undefined })} className={`${PILL} ${!industry ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All industries</Link>
          {inds.map((i) => (
            <Link key={i.slug} href={href({ industry: i.slug })} className={`${PILL} ${industry === i.slug ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
              {i.name}
            </Link>
          ))}
        </nav>
      )}
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
      {videos.length === 0 && (
        <p className="mt-10 text-center text-graphite">
          {industry ? <>No videos in this industry yet. <Link href={href({ industry: undefined })} className="underline">See all videos</Link></> : "No videos found."}
        </p>
      )}
      <Pagination page={page} pages={pages} hrefFor={qs} />
      <div className="my-10" />
    </div>
  );
}
