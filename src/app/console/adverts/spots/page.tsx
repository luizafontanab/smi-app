import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { deleteAdvertProduct, saveMediaPack } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdvertSpotsPage() {
  await requireConsole();
  const db = serviceDb();
  const [{ data: spots }, { data: pack }] = await Promise.all([
    db.from("advert_products").select("*").order("created_at"),
    db.from("settings").select("value").eq("key", "media_pack").maybeSingle(),
  ]);
  const packPath = (pack?.value as { path?: string } | null)?.path ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-gray-400 hover:text-ink">← Adverts &amp; Inventory</Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Ad Spots</h1>
        <Link href="/console/adverts/spots/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New spot</Link>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        The rate-card catalog of sellable ad products — not a booking. Book an advertiser into a format from{" "}
        <Link href="/console/adverts" className="underline">Bookings</Link>.
      </p>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-400">
              <th className="py-1">Sample</th>
              <th>Short name</th>
              <th>Format</th>
              <th>Allowable spots</th>
              <th>Description</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {(spots ?? []).map((s) => {
              const sample = mediaUrl(s.sample_path);
              return (
                <tr key={s.id} className="border-t">
                  <td className="py-2">
                    {sample ? (
                      <Image src={sample} alt={s.short_name} width={48} height={48} className="h-10 w-10 rounded object-cover" unoptimized />
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="font-medium text-ink">{s.short_name}</td>
                  <td className="text-gray-500">{s.format.replace(/_/g, " ")}</td>
                  <td>{s.cap}</td>
                  <td className="max-w-xs truncate text-gray-500">{s.description}</td>
                  <td className="text-right"><Link href={`/console/adverts/spots/${s.id}`} className="text-xs text-ink hover:underline">edit</Link></td>
                  <td className="text-right">
                    <form action={deleteAdvertProduct}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-xs text-red-500 hover:underline">delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Media pack</h2>
        <p className="mt-1 text-xs text-gray-500">
          The PDF offered on the public advertising page. Upload a new one whenever the rates or specs change.
        </p>
        {packPath && (
          <p className="mt-2 text-sm">
            <a href={mediaUrl(packPath)!} target="_blank" rel="noopener" className="text-graphite underline">current pack</a>
          </p>
        )}
        <form action={saveMediaPack} className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <input type="file" name="pack" accept="application/pdf" required className="text-sm" />
          <button className="rounded bg-ink px-4 py-2 text-white">Upload</button>
        </form>
      </section>
    </div>
  );
}
