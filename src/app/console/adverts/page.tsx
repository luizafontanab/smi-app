import Image from "next/image";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { endBooking, saveBooking } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdvertsPage() {
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: adverts }, { data: bookings }, { data: slots }, { data: placements }] = await Promise.all([
    db.from("adverts").select("id, name, format, desktop_path, advertiser:advertisers(name, member:members(name))").order("created_at"),
    db.from("advert_bookings").select("id, advert_id, starts_on, ends_on, advert:adverts(name, format)").order("ends_on"),
    db.from("advert_slots").select("*").order("key"),
    db.from("placements").select("id, kind, grid_position, starts_on, ends_on, member:members(name), machine:featured_machines(name)").order("ends_on"),
  ]);

  const live = (bookings ?? []).filter((b) => b.starts_on <= today && b.ends_on >= today);
  const liveBanners = live.filter((b) => b.advert?.format === "banner").length;
  const liveLogos = live.filter((b) => b.advert?.format === "supplier_logo").length;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-navy">Adverts &amp; Inventory</h1>
      <p className="mt-1 text-sm text-gray-500">
        Rotation is random-uniform — no advertiser can buy position. Impressions are the headline metric.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs uppercase text-gray-400">Live banners</p><p className="text-2xl font-bold text-navy">{liveBanners}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs uppercase text-gray-400">Supplier logos</p><p className="text-2xl font-bold text-navy">{liveLogos}</p></div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs uppercase text-gray-400">Slots &amp; caps</p>
          <p className="text-xs text-gray-500">{(slots ?? []).map((s) => `${s.key}:${s.cap}`).join(" · ")}</p>
        </div>
      </div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-navy">Bookings</h2>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-400"><th className="py-1">Advert</th><th>Format</th><th>Start</th><th>End</th><th /><th /></tr></thead>
          <tbody>
            {(bookings ?? []).map((b) => {
              const isLive = b.starts_on <= today && b.ends_on >= today;
              const expiring = isLive && b.ends_on <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
              return (
                <tr key={b.id} className="border-t">
                  <td className="py-2">{b.advert?.name}</td>
                  <td className="text-gray-500">{b.advert?.format}</td>
                  <td>{b.starts_on}</td>
                  <td className={expiring ? "font-semibold text-amber" : ""}>{b.ends_on}{expiring && " ⚠"}</td>
                  <td>{isLive ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">live</span> : b.starts_on > today ? "upcoming" : "ended"}</td>
                  <td className="text-right">
                    {isLive && (
                      <form action={endBooking}><input type="hidden" name="id" value={b.id} /><button className="text-xs text-red-500 hover:underline">remove</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-navy">New booking</h2>
        <form action={saveBooking} className="mt-2 flex flex-wrap items-end gap-3 text-sm">
          <label className="block">Advert
            <select name="advert_id" className="mt-1 block rounded border px-3 py-2">
              {(adverts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.format})</option>)}
            </select>
          </label>
          <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required className="mt-1 block rounded border px-3 py-2" /></label>
          <label className="block grow">Notes<input name="notes" className="mt-1 block w-full rounded border px-3 py-2" placeholder="bundle ref, rate…" /></label>
          <button className="rounded bg-navy px-4 py-2 text-white">Book</button>
        </form>
        <p className="mt-2 text-xs text-gray-400">Artwork is swappable mid-run from the advert record; dates stay. Media library upload arrives with the storage UI.</p>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-navy">Paid placements (hold their spot for the paid period)</h2>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-400"><th className="py-1">Kind</th><th>Who / what</th><th>Position</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            {(placements ?? []).map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-2">{p.kind.replace("_", " ")}</td>
                <td>{p.machine?.name ?? p.member?.name}</td>
                <td>{p.grid_position ?? "—"}</td>
                <td>{p.starts_on}</td>
                <td>{p.ends_on}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-navy">Creative preview</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(adverts ?? []).filter((a) => a.format === "banner").map((a) => (
            <div key={a.id} className="rounded border p-2">
              <Image src={mediaUrl(a.desktop_path)!} alt={a.name} width={640} height={85} className="w-full rounded" unoptimized />
              <p className="mt-1 text-xs text-gray-500">{a.name} · {a.advertiser?.name}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
