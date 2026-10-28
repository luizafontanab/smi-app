import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";
import { InvoicePanel } from "@/components/console/InvoicePanel";
import { CancelPlacementForm } from "@/components/console/CancelPlacementForm";
import { saveFeaturedEventPlacement } from "../../../actions";
import { featurableEvents } from "../events";

export const dynamic = "force-dynamic";

/** Edit one Featured Event booking — the Featured Member slot page, for the homepage's top event card. */
export default async function FeaturedEventSlotPage(props: PageProps<"/console/adverts/featured-event/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();

  const today = new Date().toISOString().slice(0, 10);
  const [slot, paid] = await Promise.all([
    must(
      db.from("placements").select("id, event_id, member_id, starts_on, ends_on, price_pennies, awaiting_payment, event:events(title)").eq("id", id).eq("kind", "featured_event").maybeSingle(),
      "console/featured-event slot",
    ),
    // a paid booking isn't cancelled from here (refunds are by hand)
    must(db.from("invoices").select("id").eq("placement_id", id).eq("status", "paid").limit(1), "console/featured-event paid invoice"),
  ]);
  if (!slot) notFound();
  // The booking's own event stays in the picker even once it no longer
  // qualifies, or a save would silently move the slot to another event.
  const events = await featurableEvents(db, today, slot.event_id);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts/featured-event" className="text-sm text-graphite hover:text-ink">← Featured Event</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Edit Featured Event booking</h1>
      {slot.awaiting_payment && <p className="mt-1 text-sm font-semibold text-brand-text">Held — not on the site until it&apos;s paid.</p>}
      <p className="mt-1 text-sm text-graphite">One event at a time; this booking doesn&apos;t clash with itself. It&apos;s billed to the event&apos;s member.</p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveFeaturedEventPlacement} className="mt-4 space-y-4 rounded-xl bg-white p-5 text-sm shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={slot.id} />
        <div>
          <label htmlFor="event_id" className="text-sm font-medium">Event</label>
          <select id="event_id" name="event_id" required defaultValue={slot.event_id ?? ""} className="mt-1 w-full rounded border px-3 py-2">
            {events.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">Start<input type="date" name="starts_on" required defaultValue={slot.starts_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required defaultValue={slot.ends_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
        </div>
        <label className="block text-sm sm:max-w-[12rem]">Price (£)
          <input name="price_pounds" inputMode="decimal" placeholder="optional" defaultValue={slot.price_pennies != null ? (slot.price_pennies / 100).toFixed(2) : ""} className="mt-1 block w-full rounded border px-3 py-2" />
        </label>
        <p className="text-xs text-graphite">A price added here is invoiced to the event&apos;s member when you save, and held for payment if it hasn&apos;t started. A new price or event on an unpaid invoice replaces it; a paid one isn&apos;t re-billed.</p>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      <InvoicePanel
        target={{ placement_id: slot.id }}
        returnTo={`/console/adverts/featured-event/${slot.id}`}
        raise={{ kind: "placement", id: slot.id, pricePennies: slot.price_pennies, billable: Boolean(slot.member_id) }}
      />
      {/* Only while nothing has run and nothing is paid — cancelPlacement checks both again. */}
      {!paid?.length && (slot.awaiting_payment || slot.starts_on > today) && (
        <CancelPlacementForm id={slot.id} noun="booking" held={slot.awaiting_payment} />
      )}
    </div>
  );
}
