import Image from "next/image";
import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { AD_FORMAT_KEYS, DEFAULT_AD_FORMATS, type AdFormat } from "@/lib/advert-formats";
import { saveAdvertFormats, saveMediaPack } from "../actions";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";

/**
 * What the public /advertising page says and offers — the media-pack PDF and the
 * six A–F format cards.
 *
 * Both used to sit on the ad-products page under Adverts, which made that page
 * own three different things at once: the rate card (since removed, fix-list
 * 77), the marketing copy, and a download. Neither of these is inventory — nothing here is bookable, capped or
 * sold — so they belong with the rest of the site's public content.
 *
 * The A–F keys are their own vocabulary: they are card slots on one marketing
 * page, unrelated to `adverts.format`, to `advert_products`, and to the
 * `advert_slots` positions. Nothing links them but the word "format".
 */
export default async function AdvertisingContentPage(props: PageProps<"/console/advertising">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();
  const [pack, formatSetting] = await Promise.all([
    must(db.from("settings").select("value").eq("key", "media_pack").maybeSingle(), "console/advertising media pack"),
    must(db.from("settings").select("value").eq("key", "advert_formats").maybeSingle(), "console/advertising formats"),
  ]);
  const packPath = (pack?.value as { path?: string } | null)?.path ?? null;
  const formats = (formatSetting?.value as AdFormat[] | null) ?? DEFAULT_AD_FORMATS;
  const formatByKey = new Map(formats.map((f) => [f.key, f]));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-ink">Advertising page</h1>
      <p className="mt-1 text-sm text-graphite">
        Content for the public{" "}
        <a href="/advertising" target="_blank" rel="noopener" className="underline">/advertising</a>{" "}
        page. How many banner spots we sell, and how many are sold, lives under{" "}
        <Link href="/console/adverts/banners" className="underline">Adverts → Banners</Link>.
      </p>

      {/* Both forms below hand their upload failures back here as ?error=. Without
          this the file inputs looked like a silent no-op. */}
      {typeof sp.error === "string" && (
        <p role="alert" className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>
      )}

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
          {/* Wrapped so the field's upload status sits under it, not as an extra item in this row. */}
          <div>
            <UploadField kind="pdf" name="pack" aria-label="Media pack PDF" accept="application/pdf" required className="text-sm" />
          </div>
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
                <p className="text-xs font-bold uppercase text-brand-text">Format {key}</p>
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
                {/* Labelled by id, not by wrapping: the field's upload status
                    and errors follow it, and inside the label they would
                    become part of the input's accessible name. */}
                <label htmlFor={`example_${key}`} className="mt-2 block text-xs text-graphite">
                  Example image shown on the public card{example ? " — leave empty to keep the current one" : ""}
                </label>
                <UploadField id={`example_${key}`} name={`example_${key}`} accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="mt-1 block text-sm" />
              </div>
            );
          })}
          <button className="rounded bg-ink px-4 py-2 text-sm text-white">Save format copy</button>
        </form>
      </section>
    </div>
  );
}
