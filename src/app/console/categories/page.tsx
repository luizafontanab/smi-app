import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Categories" };

const TABS = [
  { kind: "story", label: "Story categories" },
  { kind: "member", label: "Member sectors" },
] as const;

const usageLabel = (kind: "story" | "member", count: number) =>
  kind === "member" ? `${count} member${count === 1 ? "" : "s"}` : `${count} stor${count === 1 ? "y" : "ies"}`;

export default async function CategoriesPage(props: PageProps<"/console/categories">) {
  await requireConsole();
  const sp = await props.searchParams;
  const kind = sp.kind === "member" ? "member" : "story";
  const db = serviceDb();

  const [{ data: cats }, { data: tags }] = await Promise.all([
    db.from("categories").select("id, name, slug").eq("kind", kind).order("name"),
    kind === "member"
      ? db.from("members").select("category_id").not("category_id", "is", null)
      : db.from("story_categories").select("category_id"),
  ]);

  const counts = new Map<number, number>();
  for (const row of tags ?? []) {
    const id = row.category_id as number | null;
    if (id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">Categories</h1>
        <Link href={`/console/categories/new?kind=${kind}`} className="rounded bg-ink px-4 py-2 text-sm text-white">
          New category
        </Link>
      </div>

      <div className="mt-4 flex gap-1 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.kind}
            href={`/console/categories?kind=${t.kind}`}
            className={`rounded-t px-4 py-2 ${t.kind === kind ? "border border-b-0 bg-white font-semibold text-ink" : "text-gray-500 hover:text-ink"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {sp.saved && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Category saved.</p>}
      {sp.deleted && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Category deleted.</p>}

      <div className="mt-4 overflow-hidden rounded-b-xl rounded-tr-xl bg-white shadow-sm">
        {(cats ?? []).length === 0 && <p className="p-5 text-sm text-gray-500">No categories yet.</p>}
        <ul className="divide-y">
          {(cats ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
              <Link href={`/console/categories/${c.id}`} className="font-medium text-ink hover:text-graphite">
                {c.name}
              </Link>
              <code className="text-xs text-gray-500">{c.slug}</code>
              <span className="ml-auto text-xs text-gray-500">{usageLabel(kind, counts.get(c.id) ?? 0)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
