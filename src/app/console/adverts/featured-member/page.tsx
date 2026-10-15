import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { placementGroup } from "@/lib/booking-groups";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingCard } from "@/components/console/BookingSections";
import { PlacementCards } from "@/components/console/PlacementCards";
import { saveFeaturedMemberPlacement } from "../../actions";

export const dynamic = "force-dynamic";

/** Booked → Pending → Book a slot: the same order as the other Adverts booking pages. */
export default async function FeaturedMemberPage(props: PageProps<"/console/adverts/featured-member">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [members, slots] = await Promise.all([
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/featured-member members"),
    must(db.from("placements").select("id, starts_on, ends_on, price_pennies, awaiting_payment, member:members(name)").eq("kind", "featured_member").order("starts_on", { ascending: false }), "console/featured-member placements"),
  ]);
  const liveCount = (slots ?? []).filter((p) => placementGroup(p, today) === "booked" && p.starts_on <= today).length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Featured Member</h1>
      <p className="mt-1 text-sm text-graphite">
        Homepage carousel slot, by the month. Up to {FEATURED_SLOTS.cap} can run at once — {liveCount} live today.
      </p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <PlacementCards rows={slots ?? []} today={today} editBase="/console/adverts/featured-member" noun="slot" />

      <BookingCard title="Book a slot" hint="A priced slot is held until the member pays; unpriced goes straight to Booked. Held slots count towards the cap.">
        <form action={saveFeaturedMemberPlacement} className="space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">Price (£)<input name="price_pounds" inputMode="decimal" placeholder="optional" className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <SubmitButton pendingLabel="Booking…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Book slot</SubmitButton>
        </form>
      </BookingCard>
    </div>
  );
}
