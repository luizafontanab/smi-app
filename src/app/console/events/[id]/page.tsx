import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { consoleUploadEventImage, decideEvent, saveEvent } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/event-types";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";

export default async function EventEditor(props: PageProps<"/console/events/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  // arrived from the calendar view — go back there after saving, not to the board
  const backTo = sp.from === "calendar"
    ? `/console/events?view=calendar${/^\d{4}-\d{2}$/.test(String(sp.month ?? "")) ? `&month=${sp.month}` : ""}`
    : "/console/events";

  const [{ data: event }, { data: members }] = await Promise.all([
    isNew
      ? Promise.resolve({ data: null })
      : db.from("events").select("*, member:members(name, slug)").eq("id", id).single(),
    db.from("members").select("id, name").eq("status", "active").order("name"),
  ]);
  if (!isNew && !event) notFound();
  const cover = mediaUrl(event?.cover_path);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={backTo} className="text-sm text-graphite hover:text-ink">← Events</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New event" : "Edit event"}</h1>
      {event?.status === "rejected" && (
        <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">Rejected: {event.rejected_reason}</p>
      )}

      <form action={saveEvent} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="title" className="text-sm font-medium">Title</label>
          <input id="title" name="title" defaultValue={event?.title ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="starts_on" className="text-sm font-medium">Starts</label>
            <input id="starts_on" name="starts_on" type="date" defaultValue={event?.starts_on ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="starts_time" className="text-sm font-medium">Time (optional)</label>
            <input id="starts_time" name="starts_time" type="time" defaultValue={event?.starts_time ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="ends_on" className="text-sm font-medium">Ends (optional)</label>
            <input id="ends_on" name="ends_on" type="date" defaultValue={event?.ends_on ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="location" className="text-sm font-medium">Location</label>
            <input id="location" name="location" defaultValue={event?.location ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="link" className="text-sm font-medium">Link (optional)</label>
            <input id="link" name="link" type="url" defaultValue={event?.link ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div>
            <label htmlFor="type" className="text-sm font-medium">Type (optional)</label>
            <select id="type" name="type" defaultValue={event?.type ?? ""} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— none —</option>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <span className="block text-sm font-medium">Description</span>
          <RichTextEditor name="description" ariaLabel="Description" initialHtml={event?.description ?? ""} uploadImage={consoleUploadEventImage} minHeightClass="min-h-40" />
        </div>
        <div>
          <span className="block text-sm font-medium">Cover image</span>
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="mt-2 h-32 w-auto rounded object-cover" />
          )}
          <input type="file" name="cover" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Landscape, JPG/PNG/WebP, max 8MB.</p>
        </div>
        <div>
          <label htmlFor="member_id" className="text-sm font-medium">Hosting member (adds backlink)</label>
          <select id="member_id" name="member_id" defaultValue={event?.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— none —</option>
            {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>

      {!isNew && event && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {event.status === "awaiting_approval" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Approval</h2>
              <p className="mt-1 text-xs text-graphite">Edit above first if needed, then approve or reject.</p>
              <div className="mt-3 flex gap-2">
                <form action={decideEvent}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button className="rounded bg-success px-4 py-2 text-sm text-white">Approve & publish</button>
                </form>
              </div>
              <form action={decideEvent} className="mt-3 flex gap-2">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="decision" value="reject" />
                <input name="reason" placeholder="Reason (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
                <button className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Reject</button>
              </form>
            </div>
          )}
          {event.member && (
            <div className="rounded-xl bg-white p-5 shadow-sm text-sm">
              <h2 className="font-bold text-ink">Member preview</h2>
              <p className="mt-2 rounded border-2 border-brand bg-brand/5 p-3">
                Public page shows &ldquo;Hosted by <b>{event.member.name}</b>&rdquo; linking to their member page.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
