import Image from "next/image";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl, publicDb } from "@/lib/db/server";
import { memberDirectory } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { MemberMap } from "@/components/MemberMap";
import { Pagination } from "@/components/Pagination";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 12;

export const metadata = {
  title: "Member Directory",
  description: "Find UK sheet metal, fabrication and welding companies — search SMI's member directory by name, category or location.",
  alternates: { canonical: "/member" },
};

export default async function MembersPage(props: PageProps<"/member">) {
  const sp = await props.searchParams;
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  const q = rawQ.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const view = sp.view === "map" ? "map" : "list";

  // Map view shows every filtered match at once — a map naturally shows the
  // full result set, not a page at a time — so it skips limit/offset entirely.
  const directoryOpts = view === "map" ? { category, q } : { category, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };

  const [{ members, total }, cats, banners, showPlaceholders, ctx] = await Promise.all([
    memberDirectory(directoryOpts),
    publicDb().from("categories").select("slug, name").eq("kind", "member").order("name"),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["directory_mid"]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  record([{ kind: "page_view", path: "/member", ...ctx }]);

  // Same shape as news/page.tsx — one builder so category/q/view always survive
  // each other. Never emits a trailing slash: the e2e suite selects a[href^='/member/'].
  const qs = (over: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | number | undefined> = {
      category, q, view: view === "map" ? "map" : undefined, page: undefined, ...over,
    };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, String(v)));
    const s = params.toString();
    return s ? `/member?${s}` : "/member";
  };

  const categoryList = cats.data ?? [];
  const activeCat = categoryList.find((c) => c.slug === category);
  const withCoords = members.filter((m): m is typeof m & { lat: number; lng: number } => m.lat != null && m.lng != null);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Find a Member</h1>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* GET submit replaces the whole query string, hence the hidden category */}
        <form action="/member" role="search" className="flex min-w-0 flex-1 gap-2">
          {category && <input type="hidden" name="category" value={category} />}
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

        <CategoryCombobox
          options={categoryList.map((c) => ({ slug: c.slug, name: c.name, href: qs({ category: c.slug }) }))}
          allHref={qs({ category: undefined })}
          selected={category}
        />
      </div>

      {/* Keeps the category links in the HTML for crawlers and no-JS users. Inert
          when scripting is on, so it doesn't affect the combobox or e2e counts. */}
      <noscript>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          <a href={qs({ category: undefined })} className="rounded-full border bg-white px-3 py-1">All</a>
          {categoryList.map((c) => (
            <a key={c.slug} href={qs({ category: c.slug })} className="rounded-full border bg-white px-3 py-1">{c.name}</a>
          ))}
        </div>
      </noscript>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* aria-live: a soft router.push transition doesn't announce itself */}
        <p aria-live="polite" className="text-sm text-gray-500">
          {total} {total === 1 ? "member" : "members"}
          {activeCat && <> in {activeCat.name}</>}
          {q && <> matching “{q}”</>}
          {(q || category) && <> · <Link href={qs({ category: undefined, q: undefined })} className="text-graphite hover:underline">Clear filters</Link></>}
        </p>
        <div className="flex gap-2 text-sm">
          <Link href={qs({ view: undefined })} className={`rounded border px-3 py-1.5 ${view === "list" ? "bg-ink text-white" : "bg-white"}`}>List</Link>
          <Link href={qs({ view: "map" })} className={`rounded border px-3 py-1.5 ${view === "map" ? "bg-ink text-white" : "bg-white"}`}>Map</Link>
        </div>
      </div>

      {view === "map" ? (
        <div className="mt-6">
          {/* Coordinates are only as good as what an admin typed in manually —
              no geocoding exists yet (see docs/GAPS.md A4.5) — so coverage can
              be genuinely sparse. Say so rather than silently dropping members. */}
          {withCoords.length < members.length && (
            <p className="mb-3 text-sm text-gray-500">
              Showing {withCoords.length} of {members.length} members with a known location.
            </p>
          )}
          <MemberMap members={withCoords} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.slice(0, 6).map((m) => <MemberCard key={m.slug} member={m} />)}
          </div>
          {members.length === 0 && <p className="mt-10 text-center text-gray-500">No members found.</p>}
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
      <div className="my-6"><AdSlot slotKey="directory_mid" adverts={slots.get("directory_mid") ?? []} showPlaceholders={showPlaceholders} /></div>
      <div className="my-10" />
    </div>
  );
}

function MemberCard({ member: m }: { member: Awaited<ReturnType<typeof memberDirectory>>["members"][number] }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start gap-4">
        {m.logo_path ? (
          <Image src={mediaUrl(m.logo_path)!} alt="" width={72} height={72} className="shrink-0 rounded-lg object-contain" unoptimized />
        ) : (
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg bg-graphite/10 text-2xl text-graphite/30">⚙</div>
        )}
        <div className="min-w-0">
          <Link href={`/member/${m.slug}`} className="font-bold text-ink hover:underline">{m.name}</Link>
          {m.category && <p className="text-xs text-gray-500">{m.category.name}</p>}
        </div>
      </div>
      <p className="mt-3 text-sm text-gray-600 line-clamp-2">{m.description}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-graphite">
        <Link href={`/member/${m.slug}`} className="hover:underline">Profile</Link>
        {m.website && <a href={`/go/${m.id}?kind=website`} target="_blank" rel="noopener" className="hover:underline">Website</a>}
        {m.phone && <a href={`/go/${m.id}?kind=phone`} className="hover:underline">Call</a>}
        {m.contact_email && <a href={`/go/${m.id}?kind=email`} className="hover:underline">Email</a>}
      </div>
    </div>
  );
}
