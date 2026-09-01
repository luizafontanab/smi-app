import Image from "next/image";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { Card, SectionTitle } from "@/components/console/ui";
import { deleteResource, saveResource } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Member Resources" };

export default async function ConsoleResourcesPage(props: PageProps<"/console/resources">) {
  await requireConsole();
  const sp = await props.searchParams;
  const { data: resources } = await serviceDb().from("resources").select("id, title, path, kind, created_at").order("created_at", { ascending: false }).limit(500);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-ink">Member Resources</h1>
      <p className="mt-1 text-sm text-gray-500">Downloadable brand pack and resources shown to every member on /dashboard/resources.</p>
      {sp.saved && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Resource added.</p>}
      {sp.deleted && <p className="mt-3 rounded bg-green-50 p-2 text-sm text-green-700">Resource removed.</p>}
      {typeof sp.error === "string" && <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <Card className="mt-4">
        <SectionTitle>Add a resource</SectionTitle>
        <form action={saveResource} className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="title" className="text-sm font-medium">Title</label>
            <input id="title" name="title" required className="mt-1 w-full rounded border px-3 py-2" placeholder="Logo pack (PNG)" />
          </div>
          <div>
            <label htmlFor="file" className="text-sm font-medium">File</label>
            <input id="file" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,application/pdf" required className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-gray-500">PDF or image only — no SVG or zip.</p>
          </div>
          <div className="sm:col-span-2">
            <button className="rounded bg-ink px-5 py-2.5 text-sm text-white">Add resource</button>
          </div>
        </form>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(resources ?? []).length === 0 && <p className="text-sm text-gray-500">No resources yet.</p>}
        {(resources ?? []).map((r) => {
          const url = mediaUrl(r.path)!;
          return (
            <div key={r.id} className="rounded-lg bg-white p-3 shadow-sm">
              {r.kind === "image" ? (
                <Image src={url} alt="" width={300} height={160} className="h-32 w-full rounded object-cover" unoptimized />
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded bg-gray-50 text-3xl text-gray-300">📄</div>
              )}
              <p className="mt-2 truncate text-sm font-medium text-ink" title={r.title}>{r.title}</p>
              <form action={deleteResource} className="mt-2 flex items-center gap-1.5">
                <input type="hidden" name="id" value={r.id} />
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" name="confirm" value="1" required />
                  confirm
                </label>
                <button className="text-xs text-red-600 underline">Delete</button>
              </form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
