import Image from "next/image";
import Link from "next/link";
import { dealSlots, liveAdverts, showAdPlaceholders } from "@/lib/adverts";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl, publicDb } from "@/lib/db/server";
import { memberDirectory } from "@/lib/queries";
import { AdSlot } from "@/components/AdSlot";
import { CategoryCombobox } from "@/components/CategoryCombobox";

export const dynamic = "force-dynamic";
export const metadata = { title: "Member Directory" };

export default async function MembersPage(props: PageProps<"/members">) {
  const sp = await props.searchParams;
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const rawQ = typeof sp.q === "string" ? sp.q : "";
  const q = rawQ.trim() || undefined;
  const [members, cats, banners, showPlaceholders, ctx] = await Promise.all([
    memberDirectory({ category, q }),
    publicDb().from("categories").select("slug, name").eq("kind", "member").order("name"),
    liveAdverts("banner"),
    showAdPlaceholders(),
    requestContext(),
  ]);
  const slots = dealSlots(banners, ["directory_mid"]);
  record([{ kind: "page_view", path: "/members", ...ctx }]);

  // Same shape as news/page.tsx — one builder so category and q always survive each
  // other. Never emits a trailing slash: the e2e suite selects a[href^='/members/'].
  const qs = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = { category, q, ...over };
    Object.entries(merged).forEach(([k, v]) => v !== undefined && v !== "" && params.set(k, v));
    const s = params.toString();
    return s ? `/members?${s}` : "/members";
  };

  const categoryList = cats.data ?? [];
  const activeCat = categoryList.find((c) => c.slug === category);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Find a Member</h1>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* GET submit replaces the whole query string, hence the hidden category */}
        <form action="/members" role="search" className="flex min-w-0 flex-1 gap-2">
          {category && <input type="hidden" name="category" value={category} />}
          <input
            name="q"
            type="search"
            defaultValue={rawQ}
            placeholder="Search members by name or description…"
            aria-label="Search members"
            className="w-full rounded border bg-white px-4 py-2 text-sm"
          />
          <button className="shrink-0 rounded bg-navy px-4 py-2 text-sm text-white">Search</button>
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

      {/* aria-live: a soft router.push transition doesn't announce itself */}
      <p aria-live="polite" className="mt-3 text-sm text-gray-500">
        {members.length} {members.length === 1 ? "member" : "members"}
        {activeCat && <> in {activeCat.name}</>}
        {q && <> matching “{q}”</>}
        {(q || category) && <> · <Link href="/members" className="text-steel hover:underline">Clear filters</Link></>}
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {members.slice(0, 6).map((m) => <MemberCard key={m.slug} member={m} />)}
      </div>
      {members.length === 0 && <p className="mt-10 text-center text-gray-500">No members found.</p>}
      {/* Format A sells rotation across the directory too (advertising/page.tsx).
          Mid-list so it never pushes the member results below the fold, and
          unconditional so a narrow filter result still delivers booked inventory. */}
      <div className="my-6"><AdSlot slotKey="directory_mid" adverts={slots.get("directory_mid") ?? []} showPlaceholders={showPlaceholders} /></div>
      {members.length > 6 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.slice(6).map((m) => <MemberCard key={m.slug} member={m} />)}
        </div>
      )}
      <div className="my-10" />
    </div>
  );
}

function MemberCard({ member: m }: { member: Awaited<ReturnType<typeof memberDirectory>>[number] }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        {m.logo_path && <Image src={mediaUrl(m.logo_path)!} alt="" width={44} height={44} className="rounded" unoptimized />}
        <div>
          <Link href={`/members/${m.slug}`} className="font-bold text-navy hover:underline">{m.name}</Link>
          {m.category && <p className="text-xs text-gray-500">{m.category.name}</p>}
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{m.description}</p>
      <div className="mt-3 flex gap-3 text-xs text-steel">
        <Link href={`/members/${m.slug}`} className="hover:underline">Profile</Link>
        {m.website && <a href={m.website} target="_blank" rel="noopener" className="hover:underline">Website</a>}
        {m.phone && <a href={`tel:${m.phone}`} className="hover:underline">Call</a>}
      </div>
    </div>
  );
}
