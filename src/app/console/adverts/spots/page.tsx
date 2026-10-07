import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { bannerOccupancy, BANNERS_PER_POSITION, soldOn } from "@/lib/adverts";
import { bannerInventory } from "@/lib/banner-inventory";
import { deleteAdvertProduct, saveBannerSpots } from "../../actions";

export const dynamic = "force-dynamic";

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * What we sell and how much of it: the banner-spot count, and the rate card.
 *
 * Banners are one sitewide pool — N spots, no page and no position attached —
 * so there is one number to set, shown against bookings and never enforced.
 * The per-position caps that used to sit here were never read by anything and
 * are gone with their table (migration 20261004000002).
 *
 * Not here: the media pack and the public A–F format copy, which are website
 * content and live under Site Config → Advertising page.
 */
export default async function AdvertInventoryPage(props: PageProps<"/console/adverts/spots">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);
  const [products, { spots, bookings }] = await Promise.all([
    must(db.from("advert_products").select("*").order("created_at"), "console/adverts inventory products"),
    bannerInventory(today, "console/adverts inventory"),
  ]);
  const soldToday = soldOn(bookings, today);
  const months = bannerOccupancy(bookings, today);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Inventory</h1>
        <Link href="/console/adverts/spots/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New product</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">
        What we sell and how much of it. Nothing here is a booking — put an advertiser into a run from{" "}
        <Link href="/console/adverts" className="underline">Bookings</Link>.
      </p>

      {typeof sp.saved === "string" && <p role="status" className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Banner spots</h2>
        <p className="mt-1 text-xs text-graphite">
          Banners aren&apos;t sold by page or position. Every live banner rotates through every banner position on the
          site, and each position cycles {BANNERS_PER_POSITION} of them per page load. This number is shown against
          bookings — it never blocks one.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-6">
          <form action={saveBannerSpots} className="flex items-end gap-2 text-sm">
            <label className="block">Spots we sell
              <input name="count" type="number" min={1} step={1} defaultValue={spots} required className="mt-1 block w-20 rounded border px-2 py-1.5 text-right" />
            </label>
            <button className="rounded border px-3 py-1.5 text-graphite hover:text-ink">Save</button>
          </form>
          <div>
            <p className="text-xs uppercase tracking-wide text-graphite">Sold today</p>
            <p className={`text-2xl font-bold tabular-nums ${soldToday > spots ? "text-danger" : "text-ink"}`}>
              {soldToday} <span className="text-base font-normal text-graphite">of {spots}</span>
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-xs uppercase text-graphite">
                <th scope="col" className="py-1">Month</th>
                <th scope="col">Busiest day</th>
                <th scope="col">Spots free</th>
                <th scope="col">Awaiting approval</th>
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
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Rate card</h2>
        <p className="mt-1 text-xs text-graphite">
          The sellable products — a name, a size and a price. This is what a booking is sold as.
        </p>
        <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase text-graphite">
              <th scope="col" className="py-1">Sample</th>
              <th scope="col">Short name</th>
              <th scope="col">Format</th>
              <th scope="col">Concurrent advertisers</th>
              <th scope="col">Description</th>
              <th scope="col" />
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((s) => {
              const sample = mediaUrl(s.sample_path);
              return (
                <tr key={s.id} className="border-t">
                  <td className="py-2">
                    {sample ? (
                      <Image src={sample} alt={s.short_name} width={48} height={48} className="h-10 w-10 rounded object-cover" unoptimized />
                    ) : (
                      <span className="text-xs text-graphite">—</span>
                    )}
                  </td>
                  <td className="font-medium text-ink">{s.short_name}</td>
                  <td className="text-graphite">{s.format.replace(/_/g, " ")}</td>
                  {/* A banner product's own cap is never read — banners share the spots above. */}
                  <td>{s.format === "banner" ? <span className="text-graphite">shares the {spots} banner spots</span> : s.cap}</td>
                  <td className="max-w-xs truncate text-graphite">{s.description}</td>
                  <td className="text-right"><Link href={`/console/adverts/spots/${s.id}`} className="text-xs text-ink hover:underline">edit</Link></td>
                  <td className="text-right">
                    <form action={deleteAdvertProduct}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-xs text-danger hover:underline">delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!(products ?? []).length && (
              <tr><td colSpan={7} className="py-4 text-center text-graphite">No products on the rate card yet.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </section>

      <p className="mt-6 text-xs text-graphite">
        Looking for the media pack or the public format cards? They moved to{" "}
        <Link href="/console/advertising" className="underline">Site Config → Advertising page</Link>.
      </p>
    </div>
  );
}
