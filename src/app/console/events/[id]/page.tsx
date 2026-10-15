import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { consoleUploadEventImage, decideEvent, returnToDraft, saveEvent, setEventStatus } from "../../actions";
import { RichTextEditor } from "@/components/RichTextEditor";
import { EVENT_TYPES, EVENT_TYPE_LABELS } from "@/lib/event-types";
import { isBoardStatus, LEGAL_EVENT_MOVES } from "@/lib/event-board";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";
import { UploadField } from "@/components/UploadField";

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

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!isNew && !UUID_RE.test(id)) notFound();

  const [event, members, inds] = await Promise.all([
    isNew
      ? Promise.resolve(null)
      : must(db.from("events").select("*, member:members(name, slug, industry_id)").eq("id", id).maybeSingle(), "console/events editor"),
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/events members"),
    must(db.from("industries").select("id, name").order("sort_order"), "console/events industries"),
  ]);
  if (!isNew && !event) notFound();
  const cover = mediaUrl(event?.cover_path);
  // An industry on the row wins, else the hosting member's — same rule as the
  // story and video editors. Nothing has ever written events.industry_id, so
  // on production this fallback is where every value will come from at first.
  const industryDefault = event?.industry_id ?? event?.member?.industry_id ?? "";

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={backTo} className="text-sm text-graphite hover:text-ink">← Events</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New event" : "Edit event"}</h1>
      {event?.status === "rejected" && (
        <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">Rejected: {event.rejected_reason}</p>
      )}
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

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
          <UploadField name="cover" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Landscape, JPG/PNG/WebP, max 8MB.</p>
        </div>
        <div>
          <label htmlFor="member_id" className="text-sm font-medium">Hosting member (adds backlink)</label>
          <select id="member_id" name="member_id" defaultValue={event?.member_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— none —</option>
            {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="industry_id" className="text-sm font-medium">Industry</label>
          <select id="industry_id" name="industry_id" defaultValue={industryDefault} className="mt-1 w-full rounded border px-3 py-2">
            <option value="">— none —</option>
            {(inds ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-graphite">Drives /industry/* listings and the industry filter.</p>
        </div>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>

      {!isNew && event && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {event.status === "draft" && isBoardStatus(event.status) && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Status</h2>
              <p className="mt-1 text-xs text-graphite">Admin-authored drafts publish directly — no approval needed.</p>
              <form action={setEventStatus} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="id" value={id} />
                <select name="status" defaultValue={event.status} className="rounded border px-2 py-1.5 text-sm">
                  <option value={event.status}>Draft</option>
                  {LEGAL_EVENT_MOVES[event.status].map((to) => (
                    <option key={to} value={to}>Published</option>
                  ))}
                </select>
                <button className="rounded bg-ink px-3 py-1.5 text-sm text-white">Update</button>
              </form>
            </div>
          )}
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
          {event.status === "published" && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-ink">Take it down</h2>
              <p className="mt-1 text-xs text-graphite">
                Returns the event to draft so it drops off the public listing and calendar. Edit and re-approve to put it back.
              </p>
              <form action={returnToDraft} className="mt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="kind" value="event" />
                <button className="rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Return to draft</button>
                <p className="mt-1 text-xs text-graphite">The member is not emailed.</p>
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
