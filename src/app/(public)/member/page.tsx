import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { mediaUrl } from "@/lib/db/server";
import { narrowOptions } from "@/lib/member-facets";
import { featuredMembers, industries as industryList, memberDirectory, memberFacets, memberPins, membershipTypes, services as allServices } from "@/lib/queries";
import { OG_BASE, SITE_CARD } from "@/lib/seo";
import { AdSlot } from "@/components/AdSlot";
import { MemberCloud } from "@/components/MemberCloud";
import { MemberMap } from "@/components/MemberMap";
import { MultiSelectCombobox } from "@/components/MultiSelectCombobox";
import { Pagination } from "@/components/Pagination";
import { MemberTile } from "@/components/cards";

/** A searchParams value is `string | string[] | undefined` — normalise either shape to an array. */
const asArray = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
const toggled = (arr: string[], slug: string) => (arr.includes(slug) ? arr.filter((s) => s !== slug) : [...arr, slug]);

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

const TITLE = "Member Directory";
const DESCRIPTION = "Find UK sheet metal, fabrication and welding companies — search SMI's member directory by name, service or location.";

// openGraph/twitter restated in full: Next merges metadata shallowly, so a
// page-level openGraph would drop the layout's — and without one, shares of
// the directory showed the homepage's title and description.
export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/member" },
  openGraph: { ...OG_BASE, type: "website", url: "/member", title: TITLE, description: DESCRIPTION, images: [SITE_CARD] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [SITE_CARD] },
} satisfies Metadata;

export default async function MembersPage(props: PageProps<"/member">) {
  const sp = await props.searchParams;
  // `?industry=` since 20260909000002 renamed the taxonomy. `?category=` is
  // still read because it is a public URL surface — /industry/[slug] linked to
  // it and external links may exist — but nothing emits it any more.
  // Industries hidden from the public (flag industries_public): no pills or
  // labels, and an old ?industry= link is ignored rather than filtering invisibly.
  const showIndustries = await isFeatureEnabled("industries_public");
  const industrySlugs = showIndustries ? [...asArray(sp.industry), ...asArray(sp.category)] : [];
  const services = asArray(sp.service);
  const membershipTypeSlugs = asArray(sp.type);
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  const q = rawQ.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  // List is the landing view (28 Oct); cloud and map are opt-in, so they are
  // the ones emitted and preserved. `?view=list` was emitted while the cloud
  // was the default and may be bookmarked or linked — it still reads as list.
  const view = sp.view === "map" ? "map" : sp.view === "cloud" ? "cloud" : "list";

  // Neither map nor cloud pages: a map naturally plots the whole filtered set,
  // and a word map of twelve names is not a word map. Both take every match at
  // once — the map via the pin projection (slug/name/lat/lng), the cloud via
  // memberDirectory's existing no-limit contract (the homepage logo wall relies
  // on the same one, so its return shape must not change).
  const isMap = view === "map";
  const isList = view === "list";

  const filters = { industries: industrySlugs, services, membershipTypes: membershipTypeSlugs, q };
  const [dir, pins, inds, serviceList, typeList, facets, featuredPlacements, banners, showPlaceholders, ctx] = await Promise.all([
    isMap ? null : memberDirectory({ ...filters, ...(isList ? { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE } : {}) }),
    isMap ? memberPins(filters) : null,
    showIndustries ? industryList() : [],
    allServices(),
    membershipTypes(),
    // Which options still lead to a member, given the other filters (GAPS A9.1).
    memberFacets(filters),
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

  // Same shape as news/page.tsx — one builder so industry/service/q/view always
  // survive each other. Never emits a trailing slash: e2e selects a[href^='/member/'].
  const qs = (over: Record<string, string | string[] | number | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | string[] | number | undefined> = {
      // List is the default, so it is the one view that emits no param.
      industry: industrySlugs, service: services, type: membershipTypeSlugs, q, view: view === "list" ? undefined : view, page: undefined, ...over,
    };
    Object.entries(merged).forEach(([k, v]) => {
      if (v === undefined || v === "") return;
      if (Array.isArray(v)) v.forEach((item) => item && params.append(k, item));
      else params.set(k, String(v));
    });
    const s = params.toString();
    return s ? `/member?${s}` : "/member";
  };

  // Each list offers only what at least one member matching the *other*
  // filters has, plus whatever is already selected so it can be unticked
  // (GAPS A9.1). Null facets (nothing filtered) leaves every list whole.
  const industryOptions = narrowOptions(inds, facets?.industries ?? null, industrySlugs);
  const serviceOptions = narrowOptions(serviceList, facets?.services ?? null, services);
  const typeOptions = narrowOptions(typeList, facets?.membershipTypes ?? null, membershipTypeSlugs);
  const activeIndustries = inds.filter((i) => industrySlugs.includes(i.slug));
  const withCoords = pinRows.filter((m): m is typeof m & { lat: number; lng: number } => m.lat != null && m.lng != null);

  // A member can hold overlapping featured placements — show each member once.
  const featured = [...new Map(featuredPlacements.flatMap((p) => (p.member ? [[p.member.slug, p.member] as const] : []))).values()];
  // The cloud's big orange names are the same paid placement as the strip
  // above, not a second notion of "featured" — reuse the deduped list.
  const featuredSlugs = new Set(featured.map((m) => m.slug));
  // Same shape as memberDirectory's own shuffle seed, so the cloud's layout
  // holds still for the day and rotates with the listing at UTC midnight.
  const cloudSeed = `${new Date().toISOString().slice(0, 10)}|${industrySlugs.join(",")}|${services.join(",")}|${membershipTypeSlugs.join(",")}|${q ?? ""}`;

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
          {/* Tighter on phones (#33): five 72px cards pushed the search below
              the fold. 40px logos and less padding; sm-and-up unchanged. */}
          <div className="mt-2 grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {featured.map((m) => (
              <Link key={m.slug} href={`/member/${m.slug}`} className="tap flex items-center gap-3 rounded-lg bg-white p-2 shadow-sm sm:p-3">
                {m.logo_path ? (
                  <Image src={mediaUrl(m.logo_path)!} alt="" width={48} height={48} className="h-10 w-10 shrink-0 rounded object-contain sm:h-12 sm:w-12" unoptimized />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-graphite/10 text-xl text-graphite/30 sm:h-12 sm:w-12">⚙</div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink">{m.name}</p>
                  {showIndustries && m.industry && <p className="text-xs text-graphite">{m.industry.name}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <h2 className="mt-8 text-lg font-bold text-ink sm:mt-16">All members</h2>
      {/* Search gets a row of its own until lg: beside two 256px filters it was
          squeezed to ~128px on a tablet (#33). */}
      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        {/* GET submit replaces the whole query string, hence the hidden industry/service */}
        <form action="/member" role="search" className="flex min-w-0 flex-1 gap-2">
          {industrySlugs.map((s) => <input key={s} type="hidden" name="industry" value={s} />)}
          {services.map((s) => <input key={s} type="hidden" name="service" value={s} />)}
          {membershipTypeSlugs.map((t) => <input key={t} type="hidden" name="type" value={t} />)}
          {/* Both non-default views, or searching from the cloud silently
              throws you into the list and the view is lost on every search. */}
          {view !== "list" && <input type="hidden" name="view" value={view} />}
          <input
            name="q"
            type="search"
            defaultValue={rawQ}
            placeholder="Search members by name or description…"
            aria-label="Search members"
            enterKeyHint="search"
            // 16px on phones so iOS doesn't zoom the page on focus (#33)
            className="tap w-full min-w-0 rounded border border-line bg-white px-4 py-2 text-base sm:text-sm"
          />
          <button className="tap shrink-0 rounded bg-ink px-4 py-2 text-sm text-white">Search</button>
        </form>

        <div className="flex flex-col gap-2 sm:flex-row">
          <MultiSelectCombobox
            label="Services"
            options={serviceOptions.map((s) => ({ slug: s.slug, name: s.name, href: qs({ service: toggled(services, s.slug) }) }))}
            clearHref={qs({ service: undefined })}
            selectedSlugs={services}
          />
          <MultiSelectCombobox
            label="Membership type"
            options={typeOptions.map((t) => ({ slug: t.slug, name: t.name, href: qs({ type: toggled(membershipTypeSlugs, t.slug) }) }))}
            clearHref={qs({ type: undefined })}
            selectedSlugs={membershipTypeSlugs}
          />
        </div>
      </div>

      {/* Industry pills, single-select — same pattern and same underlying data
          as /news's industry filter (the `industries` table), plain Links so
          they work with no JS and need no noscript fallback. */}
      {showIndustries && (
        <nav aria-label="Filter by industry" className="mt-3 flex min-w-0 gap-1.5 overflow-x-auto pb-1 text-xs">
          <Link href={qs({ industry: undefined })} className={`shrink-0 rounded-full border px-3 py-1 ${industrySlugs.length === 0 ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>All industries</Link>
          {industryOptions.map((c) => (
            <Link key={c.slug} href={qs({ industry: [c.slug] })} className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 ${industrySlugs.includes(c.slug) ? "bg-ink text-white" : "bg-white hover:border-ink"}`}>
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* aria-live: a soft router.push transition doesn't announce itself */}
        <p aria-live="polite" className="text-sm text-graphite">
          {total} {total === 1 ? "member" : "members"}
          {activeIndustries.length > 0 && <> in {activeIndustries.map((i) => i.name).join(", ")}</>}
          {q && <> matching “{q}”</>}
          {(q || industrySlugs.length > 0 || services.length > 0 || membershipTypeSlugs.length > 0) && (
            <> · <Link href={qs({ industry: undefined, service: undefined, type: undefined, q: undefined })} className="text-graphite hover:underline">Clear filters</Link></>
          )}
        </p>
        {/* "Map" is the geographic one and keeps that name; the word map is
            "Cloud" so the two are never confused in a toggle. */}
        <div className="flex gap-2 text-sm">
          {([["list", "List"], ["cloud", "Cloud"], ["map", "Map"]] as const).map(([key, label]) => (
            <Link
              key={key}
              href={qs({ view: key === "list" ? undefined : key })}
              aria-current={view === key ? "true" : undefined}
              className={`tap rounded border px-3 py-1.5 ${view === key ? "bg-ink text-white" : "bg-white"}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {view === "map" ? (
        <div className="mt-6">
          {/* Addresses are geocoded on save (A4.5), but one that doesn't
              resolve gets no pin — so coverage can be sparse. Say so rather
              than silently dropping members. */}
          {withCoords.length < pinRows.length && (
            <p className="mb-3 text-sm text-graphite">
              Showing {withCoords.length} of {pinRows.length} members with a known location.
            </p>
          )}
          <MemberMap members={withCoords} />
        </div>
      ) : members.length === 0 ? (
        /* Shared by list and cloud: this is what an over-narrow filter lands
           on in either. e2e asserts the literal
           string. (Map has its own coverage note above instead.) */
        <p className="mt-10 text-center text-graphite">No members found.</p>
      ) : view === "cloud" ? (
        <MemberCloud
          seed={cloudSeed}
          listHref={qs({ view: undefined })}
          members={members.map((m) => ({
            slug: m.slug,
            name: m.name,
            logoUrl: mediaUrl(m.logo_path),
            featured: featuredSlugs.has(m.slug),
          }))}
        />
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.slice(0, 6).map((m) => <MemberTile key={m.slug} member={m} showIndustry={showIndustries} />)}
          </div>
          {members.length > 6 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.slice(6).map((m) => <MemberTile key={m.slug} member={m} showIndustry={showIndustries} />)}
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

