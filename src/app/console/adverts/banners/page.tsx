import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { bannerOccupancy, BANNERS_PER_POSITION, soldOn } from "@/lib/adverts";
import { bannerInventory } from "@/lib/banner-inventory";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { SubmitButton } from "@/components/SubmitButton";
import { BookingCard } from "@/components/console/BookingSections";
import { ArtworkRunCards } from "@/components/console/ArtworkRunCards";
import { saveBannerRun, saveBannerSpots } from "../../actions";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Banners: how many banner spots we sell, and how many are sold.
 *
 * Was "Inventory" at /console/adverts/spots, which also held a rate card of
 * named products with prices. Fix-list 77 removed the rate card — a booking
 * carries its own price now — which left this page about banners alone, so
 * fix-list 79 named it that. /console/adverts/spots redirects here.
 *
 * Banners are one sitewide pool — N spots, no page and no position attached —
 * so there is one number to set, shown against bookings and never enforced.
 * The per-position caps that used to sit here were never read by anything and
 * are gone with their table (migration 20261004000002).
 *
 * Booked → Pending → Book a banner, under a compact spots card: the same
 * order as Supplier Logos, Featured Member, Takeover and Bundles. Banners
 * are booked here in one step (artwork + run); the Bookings page can still
 * book existing artwork.
 *
 * Not here: the media pack and the public A–F format copy, which are website
 * content and live under Site Config → Advertising page.
 */
export default async function BannersPage(props: PageProps<"/console/adverts/banners">) {
  await requireConsole();
  const sp = await props.searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const db = serviceDb();
  const [{ spots, bookings }, members, runs] = await Promise.all([
    bannerInventory(today, "console/adverts banners"),
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/banners members"),
    must(
      db.from("advert_bookings")
        .select("id, status, starts_on, ends_on, price_pennies, advert:adverts!inner(name, format, mobile_path, member:members(name))")
        .in("advert.format", ["banner", "banner_narrow"])
        .order("ends_on", { ascending: false })
        .limit(500),
      "console/banners bookings",
    ),
  ]);
  const soldToday = soldOn(bookings, today);
  const months = bannerOccupancy(bookings, today);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Banners</h1>
      <p className="mt-1 text-sm text-graphite">
        Sitewide banners: every live banner rotates through every banner position, {BANNERS_PER_POSITION} per position per page load.
      </p>

      {typeof sp.saved === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <section className="mt-4 rounded-xl border border-black/5 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-ink">Banner spots</h2>
            <p className={`text-2xl font-bold tabular-nums ${soldToday > spots ? "text-danger" : "text-ink"}`}>
              {soldToday} <span className="text-base font-normal text-graphite">of {spots} sold today</span>
            </p>
          </div>
          <form action={saveBannerSpots} className="flex items-end gap-2 text-sm">
            <label className="block">Spots we sell
              <input name="count" type="number" min={1} step={1} defaultValue={spots} required className="mt-1 block w-20 rounded border px-2 py-1.5 text-right" />
            </label>
            <SubmitButton className="rounded border px-3 py-1.5 text-graphite hover:text-ink" pendingLabel="Saving…">Save</SubmitButton>
          </form>
        </div>
        <p className="mt-1 text-xs text-graphite">Shown against bookings — it never blocks one.</p>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-graphite hover:text-ink">Months ahead</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left text-xs uppercase text-graphite">
                  <th scope="col" className="py-1">Month</th>
                  <th scope="col">Busiest day</th>
                  <th scope="col">Spots free</th>
                  <th scope="col">Pending</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const free = spots - m.peak.count;
                  return (
                    <tr key={m.month} className="border-t">
                      <td className="py-2 font-medium text-ink">{monthLabel(m.month)}</td>
                      <td className="tabular-nums">
                        {m.peak.day ? `${m.peak.count} sold · ${dayLabel(m.peak.day)}` : <span className="text-graphite">none sold</span>}
                      </td>
                      <td className={`tabular-nums ${free < 0 ? "font-semibold text-danger" : ""}`}>
                        {free < 0 ? `over by ${-free}` : free}
                      </td>
                      <td className="tabular-nums text-graphite">{m.pending || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <ArtworkRunCards runs={runs ?? []} today={today} editBase="/console/adverts/banners" noun="banner" />

      <BookingCard title="Book a banner" hint="A priced banner is held until the member pays; unpriced goes straight to Booked.">
        <form action={saveBannerRun} className="space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="desktop" className="text-sm font-medium">Desktop image (1280×170)</label>
              <UploadField id="desktop" name="desktop" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <div>
              <label htmlFor="mobile" className="text-sm font-medium">Mobile image (370×280)</label>
              <UploadField id="mobile" name="mobile" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
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
          <SubmitButton pendingLabel="Booking…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Book banner</SubmitButton>
        </form>
      </BookingCard>

      <p className="mt-6 text-xs text-graphite">
        Looking for the media pack or the public format cards? They moved to{" "}
        <Link href="/console/advertising" className="underline">Site Config → Advertising page</Link>.
      </p>
    </div>
  );
}
