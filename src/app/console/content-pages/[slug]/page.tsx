import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { consoleUploadImage, deleteContentPage, saveContentPage } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function ContentPageEditor(props: PageProps<"/console/content-pages/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const isNew = slug === "new";

  // `slug` is a text key, so there is no malformed-id class to guard against.
  const page = isNew
    ? null
    : await must(serviceDb().from("static_pages").select("id, slug, title, body, collapsible").eq("slug", slug).maybeSingle(), "console/content-pages editor");
  if (!isNew && !page) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/content-pages" className="text-sm text-graphite hover:text-ink">← Content Pages</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New page" : `Edit “${page!.title}”`}</h1>
      {sp.error && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {sp.saved && <p className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}

      <form action={saveContentPage} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="original_slug" value={isNew ? "" : page!.slug} />
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <input id="title" name="title" defaultValue={page?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="slug" className="text-sm font-medium">Web address</label>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-sm text-graphite">/pages/</span>
            <input id="slug" name="slug" defaultValue={page?.slug ?? ""} placeholder="from the title" className="w-full rounded border px-3 py-2" />
          </div>
          {/* Changing it is allowed — saveContentPage records a 301 from the old
              path so anything already linking here keeps working. */}
          <p className="mt-1 text-xs text-graphite">Leave blank to derive it from the title. Changing it redirects the old address here.</p>
        </div>
        <div>
          <span className="block text-sm font-medium">Page content</span>
          <RichTextEditor name="body" ariaLabel="Page content" initialHtml={page?.body ?? ""} uploadImage={consoleUploadImage} minHeightClass="min-h-80" />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="collapsible" defaultChecked={page?.collapsible ?? false} />
            Collapsible sections
          </label>
          <p className="mt-1 text-xs text-graphite">Render each heading as an expandable section (used for Policies and FAQ).</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="rounded bg-ink px-5 py-2.5 text-white" pendingLabel="Saving…">Save</SubmitButton>
          {!isNew && (
            <>
              <Link href={`/pages/${page!.slug}`} className="text-sm text-graphite underline">View page →</Link>
              <Link href={`/console/pages?type=static_page&entity=${page!.id}`} className="text-sm text-graphite underline">
                Arrange blocks →
              </Link>
            </>
          )}
        </div>
      </form>

      {!isNew && (
        <form action={deleteContentPage} className="mt-4 rounded-xl border border-danger/30 bg-white p-5 shadow-sm">
          <input type="hidden" name="slug" value={page!.slug} />
          <h2 className="font-bold text-ink">Delete this page</h2>
          <p className="mt-1 text-xs text-graphite">
            /pages/{page!.slug} will 404 afterwards. If it has inbound links, rename it instead — that leaves a redirect behind.
          </p>
          <SubmitButton className="mt-3 rounded border border-danger/30 px-4 py-2 text-sm text-danger" pendingLabel="Deleting…">Delete</SubmitButton>
        </form>
      )}
    </div>
  );
}
