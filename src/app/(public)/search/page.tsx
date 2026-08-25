import Image from "next/image";
import Link from "next/link";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl } from "@/lib/db/server";
import { searchSite } from "@/lib/queries";
import { StoryCard } from "@/components/StoryCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

export default async function SearchPage(props: PageProps<"/search">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [{ members, stories }, ctx] = await Promise.all([
    q ? searchSite(q) : Promise.resolve({ members: [], stories: [] }),
    requestContext(),
  ]);
  record([{ kind: "page_view", path: "/search", ...ctx }]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Search</h1>
      <form className="mt-4 flex max-w-xl gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search stories, members, machinery…"
          className="w-full rounded border bg-white px-4 py-2.5"
          autoFocus
        />
        <button className="rounded bg-ink px-5 py-2.5 text-white">Search</button>
      </form>

      {/* Members always rank first — the hierarchy rule */}
      {members.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand">Members</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => (
              <Link key={m.slug} href={`/member/${m.slug}`} className="flex items-center gap-3 rounded-lg border-2 border-brand/40 bg-white p-3 shadow-sm hover:border-brand">
                {m.logo_path && <Image src={mediaUrl(m.logo_path)!} alt="" width={40} height={40} className="rounded" unoptimized />}
                <div>
                  <p className="font-semibold text-ink">{m.name}</p>
                  <p className="text-xs text-gray-500 line-clamp-1">{m.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {stories.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink">Stories</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((s) => <StoryCard key={s.id} story={s} />)}
          </div>
        </section>
      )}

      {q && members.length === 0 && stories.length === 0 && (
        <p className="mt-10 text-gray-500">Nothing found for “{q}”.</p>
      )}
      <div className="my-10" />
    </div>
  );
}
