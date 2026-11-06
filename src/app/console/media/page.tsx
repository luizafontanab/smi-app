import Link from "next/link";
import Image from "next/image";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { mustList } from "@/lib/db/must";
import { deleteMedia, renameMedia } from "../actions";
import { CopyUrlButton } from "./CopyUrlButton";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Media Library" };

const PAGE_SIZE = 24;

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const kb = (bytes: number | null) => (bytes == null ? "—" : bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`);

export default async function MediaLibraryPage(props: PageProps<"/console/media">) {
  await requireConsole();
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const { data: media, count } = await mustList(
    serviceDb()
      .from("media")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    "console/media library",
  );

  const total = count ?? 0;
  const hasNext = page * PAGE_SIZE < total;
  const hasPrev = page > 1;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold text-ink">Media Library</h1>
      <p className="mt-1 text-sm text-graphite">
        Everything uploaded through a form in this app, going forward. Nothing links this back to where it&apos;s used —
        deleting a file removes it everywhere it&apos;s shown.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(media ?? []).length === 0 && <p className="text-sm text-graphite">No uploads recorded yet.</p>}
        {(media ?? []).map((m) => {
          const url = mediaUrl(m.path)!;
          return (
            <div key={m.id} className="rounded-lg bg-white p-3 shadow-sm">
              {m.kind === "image" ? (
                <Image src={url} alt={m.alt_text ?? m.original_name ?? ""} width={300} height={160} className="h-32 w-full rounded object-cover" unoptimized />
              ) : (
                <div className="flex h-32 w-full items-center justify-center rounded bg-shade text-3xl text-graphite/40">📄</div>
              )}
              <p className="mt-2 truncate text-sm font-medium text-ink" title={m.original_name ?? m.path}>
                {m.original_name ?? m.path}
              </p>
              <p className="mt-0.5 text-xs text-graphite">{kb(m.byte_size)} · {fmt(m.created_at)}</p>

              <form action={renameMedia} className="mt-2 space-y-1.5">
                <input type="hidden" name="id" value={m.id} />
                <input
                  name="original_name"
                  defaultValue={m.original_name ?? ""}
                  placeholder="File name"
                  className="w-full rounded border px-2 py-1 text-xs"
                />
                <input
                  name="alt_text"
                  defaultValue={m.alt_text ?? ""}
                  placeholder="Alt text"
                  className="w-full rounded border px-2 py-1 text-xs"
                />
                <SubmitButton className="text-xs text-graphite underline hover:text-ink" pendingLabel="Saving…">Save</SubmitButton>
              </form>

              <div className="mt-2 flex items-center justify-between">
                <CopyUrlButton url={url} />
                <form action={deleteMedia} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="path" value={m.path} />
                  <label className="flex items-center gap-1 text-xs text-graphite" title="Anything using this file will show a broken image">
                    <input type="checkbox" name="confirm" value="1" required />
                    confirm
                  </label>
                  <SubmitButton className="text-xs text-danger hover:underline" pendingLabel="Deleting…">Delete</SubmitButton>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      {(hasPrev || hasNext) && (
        <div className="mt-4 flex justify-between text-sm">
          {hasPrev ? <Link href={`/console/media?page=${page - 1}`} className="text-graphite underline">← Previous</Link> : <span />}
          {hasNext && <Link href={`/console/media?page=${page + 1}`} className="text-graphite underline">Next →</Link>}
        </div>
      )}
    </div>
  );
}
