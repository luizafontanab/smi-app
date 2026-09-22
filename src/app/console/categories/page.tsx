import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";

export const dynamic = "force-dynamic";
export const metadata = { title: "News categories" };

export default async function CategoriesPage(props: PageProps<"/console/categories">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();

  // `categories` is the news-topic vocabulary and nothing else since migration
  // 20260909000002 — industries moved to their own table and their own page,
  // so this no longer branches on a `kind` tab.
  const [cats, tags] = await Promise.all([
    must(db.from("categories").select("id, name, slug").order("name"), "console/categories list"),
    must(db.from("story_categories").select("category_id"), "console/categories story counts"),
  ]);

  const counts = new Map<number, number>();
  for (const row of tags ?? []) {
    if (row.category_id == null) continue;
    counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">News categories</h1>
        <Link href="/console/categories/new" className="rounded bg-ink px-4 py-2 text-sm text-white">
          New category
        </Link>
      </div>
      <p className="mt-2 text-sm text-graphite">
        Topics a news story can be filed under, many per story.{" "}
        <Link href="/console/industries" className="underline hover:text-ink">Industries</Link> are a separate list.
      </p>

      {sp.saved && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Category saved.</p>}
      {sp.deleted && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Category deleted.</p>}

      <div className="mt-4 overflow-hidden rounded-xl bg-white shadow-sm">
        {(cats ?? []).length === 0 && <p className="p-5 text-sm text-graphite">No categories yet.</p>}
        <ul className="divide-y">
          {(cats ?? []).map((c) => {
            const count = counts.get(c.id) ?? 0;
            return (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
                <Link href={`/console/categories/${c.id}`} className="font-medium text-ink hover:text-graphite">
                  {c.name}
                </Link>
                <code className="text-xs text-graphite">{c.slug}</code>
                <span className="ml-auto text-xs text-graphite">{count} stor{count === 1 ? "y" : "ies"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
