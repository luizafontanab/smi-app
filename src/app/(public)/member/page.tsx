import Image from "next/image";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { featuredMembers, memberCategories, memberDirectory, memberPins, membershipTypes, services as allServices } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { MemberMap } from "@/components/MemberMap";
import { MultiSelectCombobox } from "@/components/MultiSelectCombobox";
import { Pagination } from "@/components/Pagination";

/** A searchParams value is `string | string[] | undefined` — normalise either shape to an array. */
const asArray = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
const toggled = (arr: string[], slug: string) => (arr.includes(slug) ? arr.filter((s) => s !== slug) : [...arr, slug]);

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export const metadata = {
  title: "Member Directory",
  description: "Find UK sheet metal, fabrication and welding companies — search SMI's member directory by name, category or location.",
  alternates: { canonical: "/member" },
};

export default async function MembersPage(props: PageProps<"/member">) {
  const sp = await props.searchParams;
  const categories = asArray(sp.category);
  const services = asArray(sp.service);
  const membershipTypeSlugs = asArray(sp.type);
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  const q = rawQ.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const view = sp.view === "map" ? "map" : "list";

  // Map view shows every filtered match at once — a map naturally shows the
  // full result set, not a page at a time — so it uses the pin projection
  // (slug/name/lat/lng) instead of paging the full directory rows.
  const isMap = view === "map";

  const filters = { categories, services, membershipTypes: membershipTypeSlugs, q };
  const [dir, pins, cats, serviceList, typeList, featuredPlacements, banners, showPlaceholders, ctx] = await Promise.all([
    isMap ? null : memberDirectory({ ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    isMap ? memberPins(filters) : null,
    memberCategories(),
    allServices(),
    membershipTypes(),
    featuredMembers(),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const members = dir?.members ?? [];
  const pinRows = pins?.members ?? [];
  const total = (dir ?? pins)?.total ?? 0;
  const slots = dealSlots(banners, ["directory_mid"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  record([{ kind: "page_view", path: "/member", ...ctx }]);

  // Same shape as news/page.tsx — one builder so category/service/q/view always
  // survive each other. Never emits a trailing slash: e2e selects a[href^='/member/'].
  const qs = (over: Record<string, string | string[] | number | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | string[] | number | undefined> = {
      category: categories, service: services, type: membershipTypeSlugs, q, view: view === "map" ? "map" : undefined, page: undefined, ...over,
    };
    Object.entries(merged).forEach(([k, v]) => {
      if (v === undefined || v === "") return;
      if (Array.isArray(v)) v.forEach((item) => item && params.append(k, item));
      else params.set(k, String(v));
    });
    const s = params.toString();
    return s ? `/member?${s}` : "/member";
  };

  const categoryList = cats;
  const activeCats = categoryList.filter((c) => categories.includes(c.slug));
  const withCoords = pinRows.filter((m): m is typeof m & { lat: number; lng: number } => m.lat != null && m.lng != null);

  // A member can hold overlapping featured placements — show each member once.
  const featured = [...new Map(featuredPlacements.flatMap((p) => (p.member ? [[p.member.slug, p.member] as const] : []))).values()];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Find a Member</h1>

      {/* Paid placement (featured_member), so it sits above the search and both
          views keep it. The rest of the directory below is deliberately NOT
          alphabetical — memberDirectory() shuffles it with a daily seed so
          every member gets roughly the same visibility. */}
      {featured.length > 0 && (
        <section aria-labelledby="featured-members-heading" className="mt-4">
          <h2 id="featured-members-heading" className="text-sm font-semibold uppercase tracking-wide text-graphite">Featured members</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((m) => (
              <Link key={m.slug} href={`/member/${m.slug}`} className="tap flex items-center gap-3 rounded-lg bg-white p-3 shadow-sm">
                {m.logo_path ? (
                  <Image src={mediaUrl(m.logo_path)!} alt="" width={48} height={48} className="shrink-0 rounded object-contain" unoptimized />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-graphite/10 text-xl text-graphite/30">⚙</div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink">{m.name}</p>
                  {m.category && <p className="text-xs text-graphite">{m.category.name}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <h2 className="mt-16 text-lg font-bold text-ink">All members</h2>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* GET submit replaces the whole query string, hence the hidden category/service */}
        <form action="/member" role="search" className="flex min-w-0 flex-1 gap-2">
          {categories.map((c) => <input key={c} type="hidden" name="category" value={c} />)}
          {services.map((s) => <input key={s} type="hidden" name="service" value={s} />)}
          {membershipTypeSlugs.map((t) => <input key={t} type="hidden" name="type" value={t} />)}
          {view === "map" && <input type="hidden" name="view" value="map" />}
          <input
            name="q"
            type="search"
            defaultValue={rawQ}
            placeholder="Search members by name or description…"
            aria-label="Search members"
            className="w-full rounded border bg-white px-4 py-2 text-sm"
          />
          <button className="shrink-0 rounded bg-ink px-4 py-2 text-sm text-white">Search</button>
        </form>

        <MultiSelectCombobox
          label="Services"
          options={serviceList.map((s) => ({ slug: s.slug, name: s.name, href: qs({ service: toggled(services, s.slug) }) }))}
          clearHref={qs({ service: undefined })}
          selectedSlugs={services}
        />
        <MultiSelectCombobox
          label="Membership type"
          options={typeList.map((t) => ({ slug: t.slug, name: t.name, href: qs({ type: toggled(membershipTypeSlugs, t.slug) }) }))}
          clearHref={qs({ type: undefined })}
          selectedSlugs={membershipTypeSlugs}
        />
      </div>

      {/* Industry pills, single-select — same pattern and same underlying data
          as /news's industry filter (categories kind='member'), plain Links so
          they work with no JS and need no noscript fallback. */}
      <nav aria-label="Filter by industry" className="mt-3 flex min-w-0 gap-1.5 overflow-x-auto pb-1 text-xs">
        <Link href={qs({ category: undefined })} className={`shrink-0 rounded-full border px-3 py-1 ${categories.length === 0 ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All industries</Link>
        {categoryList.map((c) => (
          <Link key={c.slug} href={qs({ category: [c.slug] })} className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 ${categories.includes(c.slug) ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
            {c.name}
          </Link>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* aria-live: a soft router.push transition doesn't announce itself */}
        <p aria-live="polite" className="text-sm text-graphite">
          {total} {total === 1 ? "member" : "members"}
          {activeCats.length > 0 && <> in {activeCats.map((c) => c.name).join(", ")}</>}
          {q && <> matching “{q}”</>}
          {(q || categories.length > 0 || services.length > 0 || membershipTypeSlugs.length > 0) && (
            <> · <Link href={qs({ category: undefined, service: undefined, type: undefined, q: undefined })} className="text-graphite hover:underline">Clear filters</Link></>
          )}
        </p>
        <div className="flex gap-2 text-sm">
          <Link href={qs({ view: undefined })} aria-current={view === "list" ? "true" : undefined} className={`tap rounded border px-3 py-1.5 ${view === "list" ? "bg-ink text-white" : "bg-white"}`}>List</Link>
          <Link href={qs({ view: "map" })} aria-current={view === "map" ? "true" : undefined} className={`tap rounded border px-3 py-1.5 ${view === "map" ? "bg-ink text-white" : "bg-white"}`}>Map</Link>
        </div>
      </div>

      {view === "map" ? (
        <div className="mt-6">
          {/* Coordinates are only as good as what an admin typed in manually —
              no geocoding exists yet (see docs/GAPS.md A4.5) — so coverage can
              be genuinely sparse. Say so rather than silently dropping members. */}
          {withCoords.length < pinRows.length && (
            <p className="mb-3 text-sm text-graphite">
              Showing {withCoords.length} of {pinRows.length} members with a known location.
            </p>
          )}
          <MemberMap members={withCoords} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.slice(0, 6).map((m) => <MemberCard key={m.slug} member={m} />)}
          </div>
          {members.length === 0 && <p className="mt-10 text-center text-graphite">No members found.</p>}
          {members.length > 6 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.slice(6).map((m) => <MemberCard key={m.slug} member={m} />)}
            </div>
          )}
          <Pagination page={page} pages={pages} hrefFor={(p) => qs({ page: p })} />
        </>
      )}

      {/* Format A sells rotation across the directory too (advertising/page.tsx).
          Unconditional so a narrow filter result still delivers booked inventory. */}
      <div className="my-6"><AdSlot slotKey="directory_mid" adverts={slots.get("directory_mid") ?? []} showPlaceholders={showPlaceholders} path="/member" /></div>
      <div className="my-10" />
    </div>
  );
}

/* Deliberately spare (fix list item 24): logo, name, industry — nothing else.
   The whole card links to the member page, where description and contact
   details live. Never emits a trailing slash: e2e selects a[href^='/member/']. */
function MemberCard({ member: m }: { member: Awaited<ReturnType<typeof memberDirectory>>["members"][number] }) {
  return (
    <Link href={`/member/${m.slug}`} className="block rounded-lg bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className="flex items-center gap-4">
        {m.logo_path ? (
          // Rounded box bigger than the image inside it, so the corner radius
          // only ever clips white background, never a non-square logo's artwork.
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-white">
            <Image src={mediaUrl(m.logo_path)!} alt="" width={112} height={112} className="object-contain" unoptimized />
          </div>
        ) : (
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-graphite/10 text-3xl text-graphite/30">⚙</div>
        )}
        <div className="min-w-0">
          <p className="font-bold text-ink">{m.name}</p>
          {m.category && <p className="text-xs text-graphite">{m.category.name}</p>}
        </div>
      </div>
    </Link>
  );
}
