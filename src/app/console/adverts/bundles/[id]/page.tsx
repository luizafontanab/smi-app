import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { bookingPhase } from "@/lib/adverts";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { saveBundle, saveBundleBooking } from "../../../actions";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

export const dynamic = "force-dynamic";

export default async function BundleDetail(props: PageProps<"/console/adverts/bundles/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  // Keep a malformed id a 404 rather than an invalid-uuid throw from must().
  if (!UUID_RE.test(id)) notFound();
  const bundle = await must(
    db.from("bundles").select("id, member_id, name, price_pennies, notes, member:members(name)").eq("id", id).maybeSingle(),
    "console/bundles detail",
  );
  if (!bundle) notFound();

  const [parts, memberAdverts] = await Promise.all([
    must(db.from("advert_bookings").select("id, advert_id, status, starts_on, ends_on, advert:adverts(name, format)").eq("bundle_id", id), "console/bundles parts"),
    must(db.from("adverts").select("id, name, format").eq("member_id", bundle.member_id).order("name"), "console/bundles member adverts"),
  ]);
  const bookedAdvertIds = new Set((parts ?? []).map((p) => p.advert_id));
  const available = (memberAdverts ?? []).filter((a) => !bookedAdvertIds.has(a.id));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts/bundles" className="text-sm text-graphite hover:text-ink">← Bundles</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{bundle.name}</h1>
      <p className="mt-1 text-sm text-graphite">{bundle.member?.name}</p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Details</h2>
        <form action={saveBundle} className="mt-3 space-y-4 text-sm">
          <UnsavedChangesGuard />
          <input type="hidden" name="id" value={bundle.id} />
          <input type="hidden" name="member_id" value={bundle.member_id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-sm font-medium">Name</label>
              <input id="name" name="name" defaultValue={bundle.name} required className="mt-1 w-full rounded border px-3 py-2" />
            </div>
            <div>
              <label htmlFor="price_pounds" className="text-sm font-medium">Price (£, optional)</label>
              <input id="price_pounds" name="price_pounds" type="number" step="0.01" min="0" defaultValue={bundle.price_pennies != null ? (bundle.price_pennies / 100).toFixed(2) : ""} className="mt-1 w-full rounded border px-3 py-2" />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="text-sm font-medium">Notes</label>
            <input id="notes" name="notes" defaultValue={bundle.notes ?? ""} className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
        </form>
      </section>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Parts ({parts?.length ?? 0})</h2>
        {(parts ?? []).map((p) => (
          <p key={p.id} className="mt-2 border-t pt-2 text-sm">
            {p.advert?.name} <span className="text-graphite">({p.advert?.format})</span> — {bookingPhase(p, today)}
          </p>
        ))}
        {!parts?.length && <p className="mt-2 text-sm text-graphite">Nothing booked into this bundle yet.</p>}
      </section>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Book more parts</h2>
        <p className="mt-1 text-xs text-graphite">
          Need another format&apos;s artwork first? <Link href={`/console/adverts/artwork/new?member_id=${bundle.member_id}`} className="underline">Add it here</Link>.
        </p>
        <form action={saveBundleBooking} className="mt-3 space-y-3 text-sm">
          <input type="hidden" name="bundle_id" value={bundle.id} />
          <div className="space-y-1">
            {available.map((a) => (
              <label key={a.id} className="flex items-center gap-2">
                <input type="checkbox" name="advert_ids" value={a.id} />
                {a.name} <span className="text-xs text-graphite">({a.format})</span>
              </label>
            ))}
            {!available.length && (
              <p className="text-graphite">
                {memberAdverts?.length ? "Every piece of this member's artwork is already in this bundle." : "This member has no artwork yet."}
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <button className="rounded bg-ink px-5 py-2.5 text-white">Book selected</button>
        </form>
      </section>
    </div>
  );
}
