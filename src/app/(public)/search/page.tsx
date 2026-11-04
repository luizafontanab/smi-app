import Image from "next/image";
import Link from "next/link";
import { record, recordSearch, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { searchSite } from "@/lib/queries";
import { excerptFromHtml } from "@/lib/sanitize";
import { Pagination } from "@/components/Pagination";
import { StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export const metadata = {
  title: "Search",
  // Query-result pages are unbounded near-duplicates — keep them out of the
  // index while letting crawlers follow the result links.
  robots: { index: false, follow: true },
};

export default async function SearchPage(props: PageProps<"/search">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const memberOnly = sp.filter === "members";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ members, stories, total }, ctx] = await Promise.all([
    q ? searchSite(q, { memberOnly, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) : Promise.resolve({ members: [], stories: [], total: 0 }),
    requestContext(),
  ]);
  record([{ kind: "page_view", path: "/search", ...ctx }]);
  if (q) {
    recordSearch({
      query: q.slice(0, 200),
      results_count: total + members.length,
      session_hash: ctx.session_hash,
      consented: ctx.consented,
    });
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q, filter: memberOnly ? "members" : undefined, page: undefined, ...over };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    const s = params.toString();
    return s ? `/search?${s}` : "/search";
  };

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Search</h1>
      <form className="mt-4 flex max-w-xl gap-2" role="search">
        <label htmlFor="site-search" className="sr-only">Search the site</label>
        <input
          id="site-search"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search stories, members, machinery…"
          className="w-full rounded border bg-white px-4 py-2.5"
        />
        <button className="rounded bg-ink px-5 py-2.5 text-white">Search</button>
      </form>

      {/* Members always rank first — the hierarchy rule */}
      {members.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-text">Members</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <Link key={m.slug} href={`/member/${m.slug}`} className="flex items-center gap-3 rounded-lg border-2 border-brand/40 bg-white p-3 shadow-sm hover:border-brand">
                {/* A wide box with object-contain, not a 40px square: most
                    members' logos are wordmarks, which a square squeezed to
                    an unreadable sliver (#33 C15). */}
                {m.logo_path && (
                  <span className="relative h-12 w-20 shrink-0">
                    <Image src={mediaUrl(m.logo_path)!} alt="" fill sizes="80px" className="object-contain" unoptimized />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{m.name}</p>
                  {/* The description is stored as rich text — shown raw it
                      read "<p>Welcome to…" (#33 C2). */}
                  <p className="text-sm text-graphite line-clamp-2 sm:text-xs">{excerptFromHtml(m.description, 160)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {stories.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink">Stories</h2>
            <Link href={qs({ filter: memberOnly ? undefined : "members" })} className={`tap rounded border px-3 py-1.5 text-sm ${memberOnly ? "bg-brand text-ink" : "bg-white"}`}>
              Member stories only
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => <StoryCard key={s.id} story={s} />)}
          </div>
          <Pagination page={page} pages={pages} hrefFor={(p) => qs({ page: p })} />
        </section>
      )}

      {q && members.length === 0 && stories.length === 0 && (
        <p className="mt-10 text-graphite">Nothing found for “{q}”.</p>
      )}
      <div className="my-10" />
    </div>
  );
}
