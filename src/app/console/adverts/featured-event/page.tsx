import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { placementGroup } from "@/lib/booking-groups";
import { eventLastDay, FEATURED_EVENT_BACKUP_KEY } from "@/lib/featured-event";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingCard } from "@/components/console/BookingSections";
import { PlacementCards } from "@/components/console/PlacementCards";
import { saveFeaturedEventPlacement, setFeaturedEventBackup } from "../../actions";
import { featurableEvents } from "./events";

export const dynamic = "force-dynamic";

/**
 * Featured Event (HUMAN-TODO 4.4): the homepage's top event card. Booked →
 * Pending → Book a slot, as the other Adverts booking pages, then the backup
 * event the card shows on days nothing is booked.
 */
export default async function FeaturedEventPage(props: PageProps<"/console/adverts/featured-event">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [events, slots, backupRow] = await Promise.all([
    featurableEvents(db, today),
    must(db.from("placements").select("id, starts_on, ends_on, price_pennies, awaiting_payment, member:members(name), event:events(title, status, starts_on, ends_on)").eq("kind", "featured_event").order("starts_on", { ascending: false }), "console/featured-event placements"),
    must(db.from("settings").select("value").eq("key", FEATURED_EVENT_BACKUP_KEY).maybeSingle(), "console/featured-event backup"),
  ]);
  const backupId = (backupRow?.value as { event_id?: unknown } | null)?.event_id;
  const backup = typeof backupId === "string"
    ? await must(db.from("events").select("id, title, status, starts_on, ends_on").eq("id", backupId).maybeSingle(), "console/featured-event backup event")
    : null;
  // The pinned backup is skipped on the homepage once it stops qualifying —
  // said here, so a stale pin is noticed rather than silently ignored.
  const backupStale = backup && (backup.status !== "published" || eventLastDay(backup) < today);
  const live = (slots ?? []).find((p) => placementGroup(p, today) === "booked" && p.starts_on <= today);
  // The homepage (queries.ts featuredEvent()) skips a booked event that has
  // been unpublished or is over — said here too, so the two can't disagree.
  const liveHidden = live?.event && (live.event.status !== "published" || eventLastDay(live.event) < today);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Featured Event</h1>
      <p className="mt-1 text-sm text-graphite">
        The event card at the top of the homepage — one event at a time.{" "}
        {live && !liveHidden && <>Live today: <strong className="text-ink">{live.event?.title}</strong>.</>}
        {!live && "Nothing booked today, so the backup event below shows (or, with none pinned, the next upcoming event)."}
      </p>
      {live && liveHidden && (
        <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">
          <strong>{live.event?.title}</strong> is booked today but isn&apos;t showing — the event is {live.event?.status !== "published" ? "no longer published" : "over"}. The homepage shows the backup event (or the next upcoming one) instead. Move or cancel the booking below.
        </p>
      )}
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.pinned === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Backup event pinned.</p>}
      {typeof sp.unpinned === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Backup unpinned — the next upcoming event shows when nothing is booked.</p>}
      {typeof sp.cancelled === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Cancelled — the booking is gone and its invoice is cancelled.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <PlacementCards
        rows={slots ?? []}
        today={today}
        editBase="/console/adverts/featured-event"
        noun="booking"
        first={{ header: "Event", cell: (r) => r.event?.title ?? "—" }}
      />

      <BookingCard title="Book a slot" hint="Only one event can be featured on any day. A priced slot invoices the event's member and is held until they pay; unpriced goes straight to Booked.">
        {events.length ? (
          <form action={saveFeaturedEventPlacement} className="space-y-4 text-sm">
            <div>
              <label htmlFor="event_id" className="text-sm font-medium">Event</label>
              <select id="event_id" name="event_id" required className="mt-1 w-full rounded border px-3 py-2">
                {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
              <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
              <label className="block">Price (£)<input name="price_pounds" inputMode="decimal" placeholder="optional" className="mt-1 block w-full rounded border px-3 py-2" /></label>
            </div>
            <SubmitButton pendingLabel="Booking…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Book slot</SubmitButton>
          </form>
        ) : (
          <p className="text-sm text-graphite">No published upcoming events to feature. <Link href="/console/events" className="underline">Events →</Link></p>
        )}
      </BookingCard>

      <BookingCard
        title="Backup event"
        hint="Shown on any day nothing is booked, so the homepage card is never empty. With no backup pinned, the next upcoming event shows."
      >
        <p className="text-sm">
          {backup ? <>Pinned: <strong className="text-ink">{backup.title}</strong> ({backup.starts_on})</> : <span className="text-graphite">No backup pinned — the next upcoming event shows.</span>}
        </p>
        {backupStale && (
          <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-xs text-danger">
            This event is {backup.status !== "published" ? "no longer published" : "over"}, so the homepage is showing the next upcoming event instead. Pin another.
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {events.length > 0 && (
            <form action={setFeaturedEventBackup} className="flex flex-1 flex-wrap items-end gap-3 text-sm">
              <label className="block min-w-0 flex-1">
                <span className="sr-only">Backup event</span>
                <select name="event_id" required defaultValue={backup && !backupStale ? backup.id : ""} className="w-full rounded border px-3 py-2">
                  <option value="" disabled>Choose an event…</option>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </select>
              </label>
              <SubmitButton pendingLabel="Pinning…" className="rounded bg-ink px-4 py-2 text-white disabled:opacity-50">Pin as backup</SubmitButton>
            </form>
          )}
          {backup && (
            <form action={setFeaturedEventBackup}>
              <input type="hidden" name="event_id" value="" />
              <SubmitButton pendingLabel="Unpinning…" className="rounded border px-4 py-2 text-sm text-ink disabled:opacity-50">Unpin</SubmitButton>
            </form>
          )}
        </div>
      </BookingCard>
    </div>
  );
}
