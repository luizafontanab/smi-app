import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { AD_FORMAT_KEYS, DEFAULT_AD_FORMATS, type AdFormat } from "@/lib/advert-formats";
import { deleteAdvertProduct, saveAdvertFormats, saveMediaPack } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdvertSpotsPage() {
  await requireConsole();
  const db = serviceDb();
  const [{ data: spots }, { data: pack }, { data: formatSetting }] = await Promise.all([
    db.from("advert_products").select("*").order("created_at"),
    db.from("settings").select("value").eq("key", "media_pack").maybeSingle(),
    db.from("settings").select("value").eq("key", "advert_formats").maybeSingle(),
  ]);
  const packPath = (pack?.value as { path?: string } | null)?.path ?? null;
  const formats = (formatSetting?.value as AdFormat[] | null) ?? DEFAULT_AD_FORMATS;
  const formatByKey = new Map(formats.map((f) => [f.key, f]));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Adverts &amp; Inventory</Link>
      <div className="mt-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Ad Spots</h1>
        <Link href="/console/adverts/spots/new" className="rounded bg-ink px-4 py-2 text-sm text-white">New spot</Link>
      </div>
      <p className="mt-1 text-sm text-graphite">
        The rate-card catalog of sellable ad products — not a booking. Book an advertiser into a format from{" "}
        <Link href="/console/adverts" className="underline">Bookings</Link>.
      </p>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-left text-xs uppercase text-graphite">
              <th scope="col" className="py-1">Sample</th>
              <th scope="col">Short name</th>
              <th scope="col">Format</th>
              <th scope="col">Allowable spots</th>
              <th scope="col">Description</th>
              <th scope="col" />
              <th scope="col" />
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
          </tbody>
        </table>
        </div>
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Media pack</h2>
        <p className="mt-1 text-xs text-graphite">
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

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Format copy</h2>
        <p className="mt-1 text-xs text-graphite">
          The six format cards shown on the public advertising page. Specs are free text — leave blank rather than guess.
        </p>
        <form action={saveAdvertFormats} className="mt-3 space-y-4">
          {AD_FORMAT_KEYS.map((key) => {
            const f = formatByKey.get(key);
            const example = mediaUrl(f?.example_path ?? null);
            return (
              <div key={key} className="rounded-lg border p-3">
                <p className="text-xs font-bold uppercase text-brand">Format {key}</p>
                <input
                  name={`name_${key}`}
                  defaultValue={f?.name ?? ""}
                  placeholder="Name"
                  aria-label={`Format ${key} name`}
                  required
                  className="mt-2 w-full rounded border px-3 py-1.5 text-sm font-medium"
                />
                <textarea
                  name={`detail_${key}`}
                  defaultValue={f?.detail ?? ""}
                  placeholder="Description and specs"
                  aria-label={`Format ${key} description and specs`}
                  required
                  rows={2}
                  className="mt-2 w-full rounded border px-3 py-1.5 text-sm"
                />
                {example && (
                  <Image
                    src={example}
                    alt={`Current example ${f?.name ?? `format ${key}`} advert`}
                    width={320}
                    height={160}
                    className="mt-2 max-h-24 w-auto rounded border object-contain"
                    unoptimized
                  />
                )}
                <label className="mt-2 block text-xs text-graphite">
                  Example image shown on the public card{example ? " — leave empty to keep the current one" : ""}
                  <input type="file" name={`example_${key}`} accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="mt-1 block text-sm" />
                </label>
              </div>
            );
          })}
          <button className="rounded bg-ink px-4 py-2 text-sm text-white">Save format copy</button>
        </form>
      </section>
    </div>
  );
}
