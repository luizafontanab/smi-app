import { cookies } from "next/headers";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { parseDateParam, parseViewedCats, VIEWED_CATS_COOKIE } from "@/lib/news-prefs";
import { forYouStories, industries as industryList, mostViewedStories, publishedStories, storyCategories, storyFilterMember } from "@/lib/queries";
import { AdSlot, SupplierLogos } from "@/components/AdSlot";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { ScrollToHash } from "@/components/ScrollToHash";
import { SearchForm } from "@/components/SearchForm";
import { Carousel, StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;
const RAIL_SIZE = 10;

export const metadata = {
  title: "News",
  description: "The latest news from the UK sheet metal, fabrication and welding trade — company stories, machinery and industry developments.",
  alternates: { canonical: "/news" },
};

export default async function NewsPage(props: PageProps<"/news">) {
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const category = typeof sp.category === "string" ? sp.category : undefined;
  // Industries hidden from the public (flag industries_public): no pills, and
  // an old ?industry= link is ignored rather than filtering invisibly.
  const showIndustries = await isFeatureEnabled("industries_public");
  const industry = showIndustries && typeof sp.industry === "string" ? sp.industry : undefined;
  const from = parseDateParam(sp.from);
  const to = parseDateParam(sp.to);
  // The old top-of-page "Member news" toggle is gone (the rail + industry
  // filters replaced it), but ?filter=members must keep working on the grid —
  // it's linked from elsewhere (e2e flows, shared URLs).
  const memberOnly = sp.filter === "members";
  // ?member=<slug>: every story featuring one member — the target of a member
  // page's "See more". Resolved first so the grid filters on the id and the
  // chip can name them; an unknown or non-public slug means no filter.
  const member = await storyFilterMember(typeof sp.member === "string" ? sp.member : undefined);
  const viewedCats = parseViewedCats((await cookies()).get(VIEWED_CATS_COOKIE)?.value);

  const [{ stories: latest }, { stories: memberNews }, { stories, total }, cats, industries, banners, logos, showPlaceholders, ctx] = await Promise.all([
    publishedStories({ limit: RAIL_SIZE }),
    publishedStories({ limit: RAIL_SIZE, memberOnly: true }),
    publishedStories({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, category, memberOnly, industry, memberId: member?.id, from, to }),
    storyCategories(),
    showIndustries ? industryList() : [],
    liveAdverts("banner"),
    liveAdverts("supplier_logo"),
    showAdPlaceholders(),
    requestContext(),
  ]);

  // Third rail: personalized off the viewed_cats cookie when it exists,
  // otherwise the most-read stories of the last 30 days (rollups_daily is
  // pre-aggregated, so the fallback is cheap). Second round trip by necessity —
  // it excludes whatever the first two rails already show.
  const railIds = [...new Set([...latest, ...memberNews].map((s) => s.id))];
  const forYou = viewedCats.length > 0
    ? await forYouStories(viewedCats, { limit: RAIL_SIZE, excludeIds: railIds })
    : await mostViewedStories({ days: 30, limit: RAIL_SIZE, excludeIds: railIds });

  const slots = dealSlots(banners, ["news_mid", "footer"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // impressions come from the browser once seen — see AdCreative / /api/seen
  record([{ kind: "page_view", path: "/news", ...ctx }]);

  // #all-news: every one of these is a filter/page control for that section —
  // a full-page GET reload must land back where the visitor was acting, not
  // scroll them back up past the three rails they already scrolled past.
  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { category, industry, member: member?.slug, from, to, filter: sp.filter as string | undefined, page: undefined, ...over };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    const s = params.toString();
    return `${s ? `/news?${s}` : "/news"}#all-news`;
  };

  const hasFilters = Boolean(category || industry || member || from || to || memberOnly);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Newsroom</h1>

      {/* ── Rails: Latest / Member news / For you ────────────────────────── */}
      {latest.length > 0 && (
        <Carousel title="Latest">
          {latest.map((s) => (
            <div key={s.id} className="w-64 shrink-0"><StoryCard story={s} showExcerpt={false} /></div>
          ))}
        </Carousel>
      )}
      {memberNews.length > 0 && (
        <Carousel title="Member news" href={qs({ filter: "members", page: undefined })}>
          {memberNews.map((s) => (
            <div key={s.id} className="w-64 shrink-0"><StoryCard story={s} showExcerpt={false} /></div>
          ))}
        </Carousel>
      )}
      {forYou.length > 0 && (
        <>
          <Carousel title="For you">
            {forYou.map((s) => (
              <div key={s.id} className="w-64 shrink-0"><StoryCard story={s} showExcerpt={false} /></div>
            ))}
          </Carousel>
          <p className="mt-2 text-xs text-graphite">
            {viewedCats.length > 0 ? "Based on what you’ve been reading." : "Popular with readers over the last 30 days."}
          </p>
        </>
      )}

      {/* Rendered unconditionally — the slot is booked inventory, so it must
          not vanish on quiet days. Sits between the rails and the archive. */}
      <div className="my-8"><AdSlot slotKey="news_mid" adverts={slots.get("news_mid") ?? []} showPlaceholders={showPlaceholders} path="/news" /></div>

      {/* ── All news: search, filters, paginated grid ────────────────────── */}
      <h2 id="all-news" className="text-lg font-bold uppercase tracking-wide text-ink">All news</h2>
      {/* Safari ignores the #all-news fragment on the date form's full-page GET — see ScrollToHash */}
      <ScrollToHash />

      <SearchForm className="mt-3 flex gap-2" />

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Industry pills — the member-kind list, same data as the industries
            strip; ~69 entries, so it scrolls sideways rather than wrapping. */}
        {showIndustries && (
          <nav aria-label="Filter by industry" className="flex min-w-0 gap-1.5 overflow-x-auto pb-1 text-xs">
            <Link href={qs({ industry: undefined })} className={`shrink-0 rounded-full border px-3 py-1 ${!industry ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All industries</Link>
            {industries.map((c) => (
              <Link key={c.slug} href={qs({ industry: c.slug })} className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 ${industry === c.slug ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
                {c.name}
              </Link>
            ))}
          </nav>
        )}
        <CategoryCombobox
          options={cats.map((c) => ({ slug: c.slug, name: c.name, href: qs({ category: c.slug }) }))}
          allHref={qs({ category: undefined })}
          selected={category}
        />
      </div>

      {/* GET submit replaces the whole query string, hence the hidden fields */}
      <form action="/news#all-news" className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        {category && <input type="hidden" name="category" value={category} />}
        {industry && <input type="hidden" name="industry" value={industry} />}
        {member && <input type="hidden" name="member" value={member.slug} />}
        {memberOnly && <input type="hidden" name="filter" value="members" />}
        <label className="flex items-center gap-2">
          <span className="text-graphite">From</span>
          <input type="date" name="from" defaultValue={from} className="rounded border bg-white px-2 py-1.5" />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-graphite">To</span>
          <input type="date" name="to" defaultValue={to} className="rounded border bg-white px-2 py-1.5" />
        </label>
        <button className="rounded border bg-white px-3 py-1.5 hover:border-ink">Apply dates</button>
        {hasFilters && (
          <Link href="/news#all-news" className="text-graphite hover:underline">Clear filters</Link>
        )}
      </form>

      {member && (
        <p className="mt-4 text-sm">
          <span className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1 text-white">
            Featuring {member.name}
            <Link href={qs({ member: undefined })} aria-label={`Remove the ${member.name} filter`} className="hover:underline">×</Link>
          </span>
        </p>
      )}

      <div data-testid="all-news-grid" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((s) => <StoryCard key={s.id} story={s} showExcerpt={false} />)}
      </div>
      {stories.length === 0 && <p className="mt-10 text-center text-graphite">No stories found.</p>}

      <nav className="my-8 flex items-center justify-center gap-2 text-sm">
        {page > 1 && <Link href={qs({ page: page - 1 })} className="rounded border bg-white px-3 py-1.5">← Prev</Link>}
        <span className="px-2 text-graphite">Page {page} of {pages}</span>
        {page < pages && <Link href={qs({ page: page + 1 })} className="rounded border bg-white px-3 py-1.5">Next →</Link>}
      </nav>

      <div className="-mx-4"><SupplierLogos adverts={logos} showPlaceholders={showPlaceholders} /></div>
      <div className="my-6"><AdSlot slotKey="footer" adverts={slots.get("footer") ?? []} showPlaceholders={showPlaceholders} path="/news" /></div>
    </div>
  );
}
