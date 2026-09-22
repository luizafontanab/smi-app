import Image from "next/image";
import Link from "next/link";
import { adPreview, bookingPhase } from "@/lib/adverts";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { AdPreviewToggle } from "@/components/console/AdPreviewToggle";
import { saveBooking, saveSlotCap } from "../actions";

export const dynamic = "force-dynamic";

const PHASE_LABELS: Record<string, string> = {
  draft: "draft",
  awaiting: "awaiting approval",
  changes_needed: "changes needed",
  upcoming: "upcoming",
  live: "live",
  ended: "ended",
};

export default async function AdvertsPage() {
  await requireConsole();
  const db = serviceDb();
  // eslint-disable-next-line react-hooks/purity -- server component, per-request render is the point
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const weekOut = new Date(now + 7 * 864e5).toISOString().slice(0, 10);

  const [adverts, bookings, slots, placements, products, { count: openInterest }, previewOn] = await Promise.all([
    must(db.from("adverts").select("id, name, format, desktop_path, member:members(name)").order("created_at", { ascending: false }).limit(500), "console/adverts list"),
    must(db.from("advert_bookings").select("id, advert_id, status, starts_on, ends_on, advert:adverts(name, format)").order("ends_on").limit(500), "console/adverts bookings"),
    must(db.from("advert_slots").select("*").order("key"), "console/adverts slots"),
    must(db.from("placements").select("id, kind, grid_position, starts_on, ends_on, member:members(name), machine:featured_machines(name)").order("ends_on").limit(500), "console/adverts placements"),
    must(db.from("advert_products").select("id, short_name, format").is("archived_at", null).order("short_name"), "console/adverts products"),
    // head:true — only the count comes back, so this one goes through mustList.
    mustList(db.from("visibility_requests").select("id", { count: "exact", head: true }).eq("status", "requested"), "console/adverts open interest"),
    adPreview(),
  ]);

  const live = (bookings ?? []).filter((b) => bookingPhase(b, today) === "live");
  // Tallied per format rather than two hard-coded counters, so a format added to
  // the check constraint shows up here without another edit.
  const byFormat = live.reduce<Record<string, number>>((acc, b) => {
    const f = b.advert?.format;
    if (f) acc[f] = (acc[f] ?? 0) + 1;
    return acc;
  }, {});
  const liveFormats = Object.entries(byFormat).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold text-ink">Adverts &amp; Inventory</h1>
      <p className="mt-1 text-sm text-graphite">
        Rotation is random-uniform — no advertiser can buy position. Impressions are the headline metric.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs uppercase text-graphite">Live bookings</p>
          <p className="text-2xl font-bold text-ink">{live.length}</p>
          <p className="mt-1 text-xs text-graphite">
            {liveFormats.length ? liveFormats.map(([f, n]) => `${n} ${f.replace(/_/g, " ")}`).join(" · ") : "nothing booked"}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs uppercase text-graphite">Formats sold</p>
          <p className="text-2xl font-bold text-ink">{liveFormats.length}</p>
          <p className="mt-1 text-xs text-graphite">of 8 bookable</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><p className="text-xs uppercase text-graphite">Interest</p>
          <p className="text-2xl font-bold text-ink">{openInterest ?? 0}</p>
          <p className="mt-1 text-xs text-graphite">
            <Link href="/console/adverts/interest" className="underline">members waiting to hear back</Link>
          </p>
        </div>
      </div>

      <div className="mt-4"><AdPreviewToggle initialOn={previewOn} /></div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Slot inventory</h2>
        <p className="mt-1 text-xs text-graphite">
          How many adverts each position holds. Guidance for selling — it never affects rotation, which stays random-uniform.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(slots ?? []).map((s) => (
            <form key={s.key} action={saveSlotCap} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm">
              <input type="hidden" name="key" value={s.key} />
              <span className="grow truncate" title={s.label}>{s.label}</span>
              <input name="cap" type="number" min={0} defaultValue={s.cap} aria-label={`Capacity for ${s.label}`} className="w-16 rounded border px-2 py-1 text-right" />
              <button className="text-xs text-graphite hover:underline">save</button>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Bookings</h2>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Advert</th><th scope="col">Format</th><th scope="col">Start</th><th scope="col">End</th><th scope="col" /><th scope="col" /></tr></thead>
          <tbody>
            {(bookings ?? []).map((b) => {
              // Phase, not raw dates: a draft or sent-back booking whose dates
              // happen to span today shows nothing publicly, and must not be
              // labelled "live" here either.
              const phase = bookingPhase(b, today);
              const expiring = phase === "live" && b.ends_on <= weekOut;
              return (
                <tr key={b.id} className="border-t">
                  <td className="py-2">
                    <Link href={`/console/adverts/${b.id}`} className="hover:underline">{b.advert?.name}</Link>
                  </td>
                  <td className="text-graphite">{b.advert?.format}</td>
                  <td>{b.starts_on}</td>
                  <td className={expiring ? "font-semibold text-brand-text" : ""}>{b.ends_on}{expiring && " ⚠"}</td>
                  <td>
                    {phase === "live"
                      ? <span className="rounded bg-success/10 px-2 py-0.5 text-xs text-success">live</span>
                      : phase === "awaiting"
                      ? <span className="rounded bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand-text">awaiting approval</span>
                      : PHASE_LABELS[phase]}
                  </td>
                  <td className="text-right">
                    <Link href={`/console/adverts/${b.id}`} className="text-xs text-graphite hover:underline">open</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">New booking</h2>
        <form action={saveBooking} className="mt-2 flex flex-wrap items-end gap-3 text-sm">
          <label className="block max-w-full">Advert
            <select name="advert_id" className="mt-1 block max-w-full rounded border px-3 py-2">
              {(adverts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.format})</option>)}
            </select>
          </label>
          <label className="block max-w-full">Sold as
            <select name="product_id" className="mt-1 block max-w-full rounded border px-3 py-2">
              <option value="">— not set —</option>
              {(products ?? []).map((p) => <option key={p.id} value={p.id}>{p.short_name}</option>)}
            </select>
          </label>
          <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required className="mt-1 block rounded border px-3 py-2" /></label>
          <label className="block grow">Notes<input name="notes" className="mt-1 block w-full rounded border px-3 py-2" placeholder="rate, PO ref…" /></label>
          <button className="rounded bg-ink px-4 py-2 text-white">Book</button>
        </form>
        <p className="mt-2 text-xs text-graphite">
          Booking it here approves it — it goes live on its start date. Artwork is swappable mid-run from{" "}
          <Link href="/console/adverts/artwork" className="underline">Artwork</Link>; the dates stay put.
        </p>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-ink">Paid placements (hold their spot for the paid period)</h2>
          <span className="flex gap-3 text-xs">
            <Link href="/console/adverts/takeover" className="text-graphite hover:underline">Book a homepage takeover →</Link>
            <Link href="/console/adverts/featured-member" className="text-graphite hover:underline">Book Featured Member →</Link>
            <Link href="/console/adverts/bundles" className="text-graphite hover:underline">Bundles →</Link>
          </span>
        </div>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Kind</th><th scope="col">Who / what</th><th scope="col">Position</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
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
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Artwork preview</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* Every format, not just banners — a skyscraper or box you cannot see
              is artwork you cannot check before it goes live. */}
          {(adverts ?? []).map((a) => (
            <div key={a.id} className="rounded border p-2">
              {/* h-auto matters now the formats differ in aspect: without it the
                  width/height attributes squash a 300×600 skyscraper to a strip. */}
              <Image src={mediaUrl(a.desktop_path)!} alt={a.name} width={640} height={85} className="h-auto w-full rounded" unoptimized />
              <p className="mt-1 text-xs text-graphite">{a.name} · {a.member?.name} · {a.format}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
