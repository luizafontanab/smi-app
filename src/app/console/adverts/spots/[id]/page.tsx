import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { ADVERT_FORMATS, advertFormatOptions } from "@/components/console/advert-formats";
import { saveAdvertProduct } from "../../../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";

export default async function AdvertSpotEditor(props: PageProps<"/console/adverts/spots/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!isNew && !UUID_RE.test(id)) notFound();
  const spot = isNew
    ? null
    : await must(db.from("advert_products").select("*").eq("id", id).maybeSingle(), "console/adverts spot editor");
  if (!isNew && !spot) notFound();
  const sample = mediaUrl(spot?.sample_path);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/console/adverts/spots" className="text-sm text-graphite hover:text-ink">← Inventory</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New rate-card product" : "Edit rate-card product"}</h1>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveAdvertProduct} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <UnsavedChangesGuard />
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="short_name" className="text-sm font-medium">Short name</label>
          <input id="short_name" name="short_name" defaultValue={spot?.short_name ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div>
          <label htmlFor="description" className="text-sm font-medium">Description</label>
          <textarea id="description" name="description" defaultValue={spot?.description ?? ""} rows={3} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="format" className="text-sm font-medium">Size</label>
            <select id="format" name="format" defaultValue={spot?.format ?? ADVERT_FORMATS[0].value} required className="mt-1 w-full rounded border px-3 py-2">
              {advertFormatOptions(spot?.format).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            {/* Field name stays `cap` — the label was "Allowable spots", which
                read as an advert_slots position rather than a rate-card limit. */}
            <label htmlFor="cap" className="text-sm font-medium">Concurrent advertisers</label>
            <input id="cap" name="cap" type="number" min={1} defaultValue={spot?.cap ?? 1} required className="mt-1 w-full rounded border px-3 py-2" />
            <p className="mt-1 text-xs text-graphite">How many advertisers can hold this product at once.</p>
          </div>
        </div>
        <div>
          <label htmlFor="rate_pounds" className="text-sm font-medium">Rate (£, optional)</label>
          <input
            id="rate_pounds" name="rate_pounds" type="number" step="0.01" min="0"
            defaultValue={spot?.rate_pennies != null ? (spot.rate_pennies / 100).toFixed(2) : ""}
            className="mt-1 w-full rounded border px-3 py-2"
          />
          <p className="mt-1 text-xs text-graphite">
            Raises an invoice automatically when a booking sold as this product is approved. Leave blank to invoice manually.
          </p>
        </div>
        <div>
          <span className="block text-sm font-medium">Sample file</span>
          {sample && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sample} alt="" className="mt-2 h-24 w-auto rounded object-cover" />
          )}
          <input type="file" name="sample" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">JPG/PNG/WebP, max 8MB.</p>
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>
    </div>
  );
}
