import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Content Pages" };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default async function ContentPagesList(props: PageProps<"/console/content-pages">) {
  await requireConsole();
  const sp = await props.searchParams;
  const { data: pages } = await serviceDb()
    .from("static_pages")
    .select("slug, title, updated_at")
    .order("title");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Content Pages</h1>
        <Link href="/console/content-pages/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New page</Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Standalone pages served at /pages/… — About, Policies, the MACH magazine page. To rearrange the
        blocks these render inside, use <Link href="/console/pages?type=static_page" className="underline">Page Layouts</Link>.
      </p>
      {sp.deleted && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Page deleted.</p>}

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        {(pages ?? []).length === 0 && <p className="p-5 text-sm text-gray-500">No pages yet.</p>}
        <ul className="divide-y">
          {(pages ?? []).map((p) => (
            <li key={p.slug} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
              <Link href={`/console/content-pages/${p.slug}`} className="font-medium text-ink hover:text-graphite">{p.title}</Link>
              <code className="text-xs text-gray-500">/pages/{p.slug}</code>
              <span className="ml-auto text-xs text-gray-500">edited {fmt(p.updated_at)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
