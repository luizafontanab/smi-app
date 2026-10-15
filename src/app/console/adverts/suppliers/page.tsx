import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { bookingPhase } from "@/lib/adverts";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingCard } from "@/components/console/BookingSections";
import { ArtworkRunCards } from "@/components/console/ArtworkRunCards";
import { saveSupplierLogo } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Supplier logos (fix-list 78): the logo strip on the homepage and news pages.
 *
 * A supplier logo was always bookable — as an advert with format
 * supplier_logo, made on Artwork, then booked on Bookings — but nothing in
 * the console said "supplier", so it read as missing. This page books one in
 * a single step. The rows are ordinary bookings and still appear on the
 * Bookings page too.
 *
 * Booked → Pending → Book a supplier logo: the same order as Banners,
 * Featured Member, Takeover and Bundles.
 */
export default async function SupplierLogosPage(props: PageProps<"/console/adverts/suppliers">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [members, runs] = await Promise.all([
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/suppliers members"),
    must(
      db.from("advert_bookings")
        .select("id, status, starts_on, ends_on, price_pennies, advert:adverts!inner(name, format, mobile_path, member:members(name))")
        .eq("advert.format", "supplier_logo")
        .order("ends_on", { ascending: false })
        .limit(500),
      "console/suppliers bookings",
    ),
  ]);
  const liveCount = (runs ?? []).filter((r) => bookingPhase(r, today) === "live").length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Supplier logos</h1>
      <p className="mt-1 text-sm text-graphite">
        The rotating logo strip on the homepage and news pages — {liveCount} live today.
      </p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <ArtworkRunCards runs={runs ?? []} today={today} editBase="/console/adverts/suppliers" noun="supplier logo" />

      <BookingCard title="Book a supplier logo" hint="A priced logo is held until the member pays; unpriced goes straight to Booked.">
        <form action={saveSupplierLogo} className="space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="logo" className="text-sm font-medium">Logo</label>
            <input id="logo" name="logo" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            <p className="mt-1 text-xs text-graphite">Shown at 240×120 — a landscape logo on a transparent or white background reads best.</p>
          </div>
          <div>
            <label htmlFor="link_url" className="text-sm font-medium">Link (optional)</label>
            <input id="link_url" name="link_url" type="url" placeholder="https://… — blank links to their member page" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">Price (£)<input name="price_pounds" inputMode="decimal" placeholder="optional" className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <SubmitButton pendingLabel="Booking…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Book logo</SubmitButton>
        </form>
      </BookingCard>
    </div>
  );
}
