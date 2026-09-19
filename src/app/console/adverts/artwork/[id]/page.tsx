import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { saveAdvertArtwork } from "../../../actions";

export const dynamic = "force-dynamic";

// Mirrors the adverts.format check constraint; sizes match AdCreative.tsx.
const FORMATS = [
  { value: "banner", label: "Banner (1280×170 desktop / 370×280 mobile)" },
  // Grid homepage only, and deliberately absent from the member's own advert
  // form — see the note in dashboard/advert/AdvertForm.tsx.
  { value: "banner_narrow", label: "Banner — narrow (830×170 desktop / 370×280 mobile)" },
  { value: "skyscraper", label: "Skyscraper (300×600, desktop only)" },
  { value: "mpu", label: "MPU (300×250)" },
  { value: "in_feed", label: "In-feed (native card)" },
  { value: "supplier_logo", label: "Supplier logo" },
  { value: "newsletter_banner", label: "Newsletter banner" },
  { value: "association_logo", label: "Association logo" },
];

export default async function AdvertArtworkEditor(props: PageProps<"/console/adverts/artwork/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const isNew = id === "new";

  const [advert, { data: members }] = await Promise.all([
    isNew ? null : db.from("adverts").select("*").eq("id", id).single().then((r) => r.data),
    db.from("members").select("id, name").eq("status", "active").order("name"),
  ]);
  if (!isNew && !advert) notFound();

  // prefilled when arriving from an interest request
  const presetMember = typeof sp.member_id === "string" ? sp.member_id : "";
  const desktop = mediaUrl(advert?.desktop_path);
  const mobile = mediaUrl(advert?.mobile_path);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/console/adverts/artwork" className="text-sm text-graphite hover:text-ink">← Artwork</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{isNew ? "New artwork" : "Edit artwork"}</h1>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {sp.from === "interest" && (
        <p className="mt-2 rounded bg-brand/10 p-2 text-sm text-ink">
          Started from an interest request — add the artwork they sent you, then book its dates.
        </p>
      )}

      <form action={saveAdvertArtwork} className="mt-4 space-y-4 rounded-xl bg-white p-5 shadow-sm">
        {!isNew && <input type="hidden" name="id" value={id} />}
        <div>
          <label htmlFor="name" className="text-sm font-medium">Name</label>
          <input id="name" name="name" defaultValue={advert?.name ?? ""} required className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" defaultValue={advert?.member_id ?? presetMember} required className="mt-1 w-full rounded border px-3 py-2">
              <option value="">— choose —</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="format" className="text-sm font-medium">Format</label>
            <select id="format" name="format" defaultValue={advert?.format ?? FORMATS[0].value} required className="mt-1 w-full rounded border px-3 py-2">
              {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="link_url" className="text-sm font-medium">Link (optional)</label>
          <input id="link_url" name="link_url" type="url" defaultValue={advert?.link_url ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          <p className="mt-1 text-xs text-graphite">Leave blank to send clicks to their member page.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="block text-sm font-medium">Desktop image</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {desktop && <img src={desktop} alt="" className="mt-2 h-16 w-auto rounded border" />}
            <input type="file" name="desktop" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" required={isNew} />
          </div>
          <div>
            <span className="block text-sm font-medium">Mobile image</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {mobile && <img src={mobile} alt="" className="mt-2 h-16 w-auto rounded border" />}
            <input type="file" name="mobile" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" required={isNew} />
          </div>
        </div>
        <p className="text-xs text-graphite">
          JPG/PNG/WebP, max 8MB. Editing leaves the existing image in place unless you choose a new one — and a swap applies to every run of this artwork.
        </p>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
      </form>
    </div>
  );
}
