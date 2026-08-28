import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { saveAdvertProduct } from "../../../actions";

export const dynamic = "force-dynamic";

// Mirrors the adverts.format check constraint; sizes match AdCreative.tsx's shapes.
const FORMATS = [
  { value: "banner", label: "Banner (1280×170 desktop / 370×280 mobile)" },
  { value: "skyscraper", label: "Skyscraper (300×600, desktop only)" },
  { value: "mpu", label: "MPU (300×250)" },
  { value: "in_feed", label: "In-feed (native card)" },
  { value: "supplier_logo", label: "Supplier logo" },
  { value: "newsletter_banner", label: "Newsletter banner" },
  { value: "association_logo", label: "Association logo" },
];

export default async function AdvertSpotEditor(props: PageProps<"/console/adverts/spots/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  const { data: spot } = isNew
    ? { data: null }
    : await db.from("advert_products").select("*").eq("id", id).single();
  if (!isNew && !spot) notFound();
  const sample = mediaUrl(spot?.sample_path);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/console/adverts/spots" className="text-sm text-gray-400 hover:text-ink">← Ad Spots</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New ad spot" : "Edit ad spot"}</h1>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <form action={saveAdvertProduct} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
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
            <select id="format" name="format" defaultValue={spot?.format ?? FORMATS[0].value} required className="mt-1 w-full rounded border px-3 py-2">
              {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cap" className="text-sm font-medium">Allowable spots</label>
            <input id="cap" name="cap" type="number" min={1} defaultValue={spot?.cap ?? 1} required className="mt-1 w-full rounded border px-3 py-2" />
            <p className="mt-1 text-xs text-gray-400">How many advertisers can hold this spot at once.</p>
          </div>
        </div>
        <div>
          <span className="block text-sm font-medium">Sample file</span>
          {sample && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sample} alt="" className="mt-2 h-24 w-auto rounded object-cover" />
          )}
          <input type="file" name="sample" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-gray-400">JPG/PNG/WebP, max 8MB.</p>
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>
    </div>
  );
}
