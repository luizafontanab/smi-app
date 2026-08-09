import Link from "next/link";
import { dealSlots, liveAdverts } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { publishedStories, storyCategories } from "@/lib/queries";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export const metadata = { title: "News" };

export default async function NewsPage(props: PageProps<"/news">) {
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const memberOnly = sp.filter === "members";
  const order = sp.sort === "oldest" ? "asc" : "desc";

  const [{ stories, total }, cats, banners, logos, ctx] = await Promise.all([
    publishedStories({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, category, memberOnly, order }),
    storyCategories(),
    liveAdverts("banner"),
    liveAdverts("supplier_logo"),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["news_mid", "footer"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  record([
    { kind: "page_view", path: "/news", ...ctx },
    ...[...slots.values()].flatMap((ads) => (ads[0] ? [{ kind: "ad_impression" as const, advert_id: ads[0].advertId, ...ctx }] : [])),
  ]);

  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { category, sort: sp.sort as string | undefined, filter: sp.filter as string | undefined, page: undefined, ...over };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    const s = params.toString();
    return s ? `/news?${s}` : "/news";
  };

  return (
    <div className="mx-auto max-w-6xl px-4">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Newsroom</h1>
        <div className="flex gap-2 text-sm">
          <Link href={qs({ sort: undefined })} className={`rounded border px-3 py-1.5 ${order === "desc" ? "bg-navy text-white" : "bg-white"}`}>Most recent</Link>
          <Link href={qs({ sort: "oldest" })} className={`rounded border px-3 py-1.5 ${order === "asc" ? "bg-navy text-white" : "bg-white"}`}>Oldest</Link>
          <Link href={qs({ filter: memberOnly ? undefined : "members" })} className={`rounded border px-3 py-1.5 ${memberOnly ? "bg-amber text-navy" : "bg-white"}`}>Member news</Link>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
        <Link href={qs({ category: undefined })} className={`rounded-full border px-3 py-1 ${!category ? "bg-navy text-white" : "bg-white"}`}>All</Link>
        {cats.map((c) => (
          <Link key={c.slug} href={qs({ category: c.slug })} className={`rounded-full border px-3 py-1 ${category === c.slug ? "bg-navy text-white" : "bg-white hover:border-navy"}`}>
            {c.name}
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.slice(0, 6).map((s) => <StoryCard key={s.id} story={s} />)}
      </div>
      {stories.length > 6 && (
        <>
          <div className="my-6"><AdSlot adverts={slots.get("news_mid") ?? []} /></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stories.slice(6).map((s) => <StoryCard key={s.id} story={s} />)}
          </div>
        </>
      )}
      {stories.length === 0 && <p className="mt-10 text-center text-gray-500">No stories found.</p>}

      <nav className="my-8 flex items-center justify-center gap-2 text-sm">
        {page > 1 && <Link href={qs({ page: page - 1 })} className="rounded border bg-white px-3 py-1.5">← Prev</Link>}
        <span className="px-2 text-gray-500">Page {page} of {pages}</span>
        {page < pages && <Link href={qs({ page: page + 1 })} className="rounded border bg-white px-3 py-1.5">Next →</Link>}
      </nav>

      <div className="-mx-4"><SupplierLogos adverts={logos} /></div>
      <div className="my-6"><AdSlot adverts={slots.get("footer") ?? []} /></div>
    </div>
  );
}
