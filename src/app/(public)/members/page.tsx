import Image from "next/image";
import Link from "next/link";
import { record, requestContext } from "@/lib/analytics";
import { mediaUrl, publicDb } from "@/lib/db/server";
import { memberDirectory } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Member Directory" };

export default async function MembersPage(props: PageProps<"/members">) {
  const sp = await props.searchParams;
  const category = typeof sp.category === "string" ? sp.category : undefined;
  const [members, cats, ctx] = await Promise.all([
    memberDirectory(category),
    publicDb().from("categories").select("slug, name").eq("kind", "member").order("name"),
    requestContext(),
  ]);
  record([{ kind: "page_view", path: "/members", ...ctx }]);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-navy">Find a Member</h1>
      <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
        <Link href="/members" className={`rounded-full border px-3 py-1 ${!category ? "bg-navy text-white" : "bg-white"}`}>All</Link>
        {(cats.data ?? []).map((c) => (
          <Link key={c.slug} href={`/members?category=${c.slug}`} className={`rounded-full border px-3 py-1 ${category === c.slug ? "bg-navy text-white" : "bg-white hover:border-navy"}`}>
            {c.name}
          </Link>
        ))}
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <div key={m.slug} className="rounded-lg bg-white p-4 shadow-sm">
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
        ))}
      </div>
      <div className="my-10" />
    </div>
  );
}
