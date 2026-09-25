import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { RETIRED_SLOT_KEYS } from "@/components/console/advert-formats";
import { deleteAdvertProduct, saveSlotCap } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Everything we have to sell, in two halves that are easy to confuse:
 *
 *  - a POSITION (`advert_slots`) is a physical place on the site — `home_1`,
 *    `news_1` — and its cap says how many adverts that place holds;
 *  - a PRODUCT (`advert_products`) is a line on the rate card — a name, a size,
 *    a price — and its cap says how many advertisers may hold it at once.
 *
 * They lived on two different pages under two names that both read as "slot".
 * The headings below are the whole point of this page: say which is which.
 *
 * Not here: the media pack and the public A–F format copy, which are website
 * content and live under Site Config → Advertising page.
 */
export default async function AdvertInventoryPage() {
  await requireConsole();
  const db = serviceDb();
  const [products, slots] = await Promise.all([
    must(db.from("advert_products").select("*").order("created_at"), "console/adverts inventory products"),
    must(db.from("advert_slots").select("*").order("key"), "console/adverts inventory slots"),
  ]);

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
                  <td>{s.cap}</td>
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

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Positions on the site</h2>
        <p className="mt-1 text-xs text-graphite">
          How many adverts each physical position holds. Guidance for selling — it never affects rotation, which stays
          random-uniform. A position is where an advert appears; a rate-card product above is what someone buys.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(slots ?? []).filter((s) => !RETIRED_SLOT_KEYS.has(s.key)).map((s) => (
            <form key={s.key} action={saveSlotCap} className="flex items-center gap-2 rounded border px-3 py-1.5 text-sm">
              <input type="hidden" name="key" value={s.key} />
              <span className="grow truncate" title={s.label}>{s.label}</span>
              <input name="cap" type="number" min={0} defaultValue={s.cap} aria-label={`Capacity for ${s.label}`} className="w-16 rounded border px-2 py-1 text-right" />
              <button className="text-xs text-graphite hover:underline">save</button>
            </form>
          ))}
        </div>
      </section>

      <p className="mt-6 text-xs text-graphite">
        Looking for the media pack or the public format cards? They moved to{" "}
        <Link href="/console/advertising" className="underline">Site Config → Advertising page</Link>.
      </p>
    </div>
  );
}
