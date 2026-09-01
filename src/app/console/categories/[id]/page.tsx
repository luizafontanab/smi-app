import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { deleteCategory, saveCategory } from "../../actions";

export const dynamic = "force-dynamic";

export default async function CategoryEditor(props: PageProps<"/console/categories/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const isNew = id === "new";
  const db = serviceDb();

  const { data: category } = isNew
    ? { data: null }
    : await db.from("categories").select("id, kind, name, slug").eq("id", Number(id)).maybeSingle();
  if (!isNew && !category) notFound();

  const kind = isNew ? (sp.kind === "member" ? "member" : "story") : category!.kind;

  const usageCount = isNew
    ? 0
    : kind === "member"
      ? (await db.from("members").select("id", { count: "exact", head: true }).eq("category_id", category!.id)).count ?? 0
      : (await db.from("story_categories").select("story_id", { count: "exact", head: true }).eq("category_id", category!.id)).count ?? 0;

  return (
    <div className="mx-auto max-w-lg">
      <Link href={`/console/categories?kind=${kind}`} className="text-sm text-gray-500 hover:text-ink">← Categories</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New category" : `Edit “${category!.name}”`}</h1>
      {sp.error && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <form action={saveCategory} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <input type="hidden" name="id" value={isNew ? "" : category!.id} />
        <input type="hidden" name="kind" value={kind} />
        <div>
          <span className="text-sm font-medium">Type</span>
          <p className="mt-1 text-sm text-gray-500">{kind === "member" ? "Member sector" : "Story category"}</p>
        </div>
        <div>
          <label htmlFor="name" className="text-sm font-medium">Name</label>
          <input id="name" name="name" defaultValue={category?.name ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="slug" className="text-sm font-medium">Slug</label>
          <input id="slug" name="slug" defaultValue={category?.slug ?? ""} placeholder="from the name" className="mt-1 w-full rounded border px-3 py-2" />
          <p className="mt-1 text-xs text-gray-500">Leave blank to derive it from the name.</p>
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>

      {!isNew && (
        <form action={deleteCategory} className="mt-4 rounded-xl border border-red-200 bg-white p-5 shadow-sm">
          <input type="hidden" name="id" value={category!.id} />
          <input type="hidden" name="kind" value={kind} />
          <h2 className="font-bold text-ink">Delete this category</h2>
          <p className="mt-1 text-xs text-gray-500">
            {kind === "member"
              ? usageCount > 0
                ? `${usageCount} member${usageCount === 1 ? "" : "s"} still use this category — deleting will fail until they're recategorised.`
                : "No members use this category."
              : usageCount > 0
                ? `${usageCount} stor${usageCount === 1 ? "y" : "ies"} tagged with this category will be silently untagged.`
                : "No stories are tagged with this category."}
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="1" required />
            Yes, delete this category
          </label>
          <button className="mt-3 rounded border border-red-300 px-4 py-2 text-sm text-red-600">Delete</button>
        </form>
      )}
    </div>
  );
}
