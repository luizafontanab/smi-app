import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { publishedStories, publishedVideos, storyCategories } from "@/lib/queries";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { SearchForm } from "@/components/SearchForm";
import { StoryCard } from "@/components/StoryCard";
import { VideoCard } from "@/components/cards";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export const metadata = {
  title: "News",
  description: "The latest news from the UK sheet metal, fabrication and welding trade — company stories, machinery and industry developments.",
  alternates: { canonical: "/news" },
};

export default async function NewsPage(props: PageProps<"/news">) {
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const memberOnly = sp.filter === "members";

  const [{ stories, total }, { videos }, cats, banners, logos, showPlaceholders, ctx] = await Promise.all([
    publishedStories({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, category, memberOnly }),
    // Decorative — woven into the grid, not part of the story pagination math.
    publishedVideos({ limit: 4 }),
    storyCategories(),
    liveAdverts("banner"),
    liveAdverts("supplier_logo"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["news_mid", "footer"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // impressions come from the browser once seen — see AdCreative / /api/seen
  record([{ kind: "page_view", path: "/news", ...ctx }]);

  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { category, filter: sp.filter as string | undefined, page: undefined, ...over };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    const s = params.toString();
    return s ? `/news?${s}` : "/news";
  };

  return (
    <div className="mx-auto max-w-6xl px-4">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">Newsroom</h1>
        <div className="flex gap-2 text-sm">
          <Link href={qs({ filter: memberOnly ? undefined : "members" })} className={`rounded border px-3 py-1.5 ${memberOnly ? "bg-brand text-ink" : "bg-white"}`}>Member news</Link>
        </div>
      </div>

      <SearchForm className="mt-4 flex gap-2" />

      <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
        <Link href={qs({ category: undefined })} className={`rounded-full border px-3 py-1 ${!category ? "bg-ink text-white" : "bg-white"}`}>All</Link>
        {cats.map((c) => (
          <Link key={c.slug} href={qs({ category: c.slug })} className={`rounded-full border px-3 py-1 ${category === c.slug ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
            {c.name}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.slice(0, 6).map((s) => <StoryCard key={s.id} story={s} />)}
      </div>
      {videos.length > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {videos.map((v) => <VideoCard key={v.id} video={v} size="sm" />)}
        </div>
      )}
      {/* Rendered unconditionally — the slot is booked inventory, so it must
          not vanish just because the listing is short. Only the split below
          is count-dependent. */}
      <div className="my-6"><AdSlot slotKey="news_mid" adverts={slots.get("news_mid") ?? []} showPlaceholders={showPlaceholders} /></div>
      {stories.length > 6 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stories.slice(6).map((s) => <StoryCard key={s.id} story={s} />)}
        </div>
      )}
      {stories.length === 0 && <p className="mt-10 text-center text-gray-500">No stories found.</p>}

      <nav className="my-8 flex items-center justify-center gap-2 text-sm">
        {page > 1 && <Link href={qs({ page: page - 1 })} className="rounded border bg-white px-3 py-1.5">← Prev</Link>}
        <span className="px-2 text-gray-500">Page {page} of {pages}</span>
        {page < pages && <Link href={qs({ page: page + 1 })} className="rounded border bg-white px-3 py-1.5">Next →</Link>}
      </nav>

      <div className="-mx-4"><SupplierLogos adverts={logos} showPlaceholders={showPlaceholders} /></div>
      <div className="my-6"><AdSlot slotKey="footer" adverts={slots.get("footer") ?? []} showPlaceholders={showPlaceholders} /></div>
    </div>
  );
}
