import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { saveBundle } from "../../actions";

export const dynamic = "force-dynamic";

export default async function BundlesPage() {
  await requireConsole();
  const db = serviceDb();

  const [members, bundles] = await Promise.all([
    must(db.from("members").select("id, name").eq("status", "active").order("name"), "console/bundles members"),
    must(db.from("bundles").select("id, name, price_pennies, member:members(name), parts:advert_bookings(count)").order("created_at", { ascending: false }), "console/bundles list"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Adverts &amp; Inventory</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Bundles</h1>
      <p className="mt-1 text-sm text-graphite">
        Several ad formats sold together to one member under a single price. Add the artwork first via{" "}
        <Link href="/console/adverts/artwork" className="underline">Artwork</Link>, then book it into a bundle here.
      </p>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">New bundle</h2>
        <form action={saveBundle} className="mt-3 space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="text-sm font-medium">Bundle name</label>
              <input id="name" name="name" required className="mt-1 w-full rounded border px-3 py-2" />
            </div>
            <div>
              <label htmlFor="price_pounds" className="text-sm font-medium">Price (£, optional)</label>
              <input id="price_pounds" name="price_pounds" type="number" step="0.01" min="0" className="mt-1 w-full rounded border px-3 py-2" />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="text-sm font-medium">Notes</label>
            <input id="notes" name="notes" className="mt-1 w-full rounded border px-3 py-2" />
          </div>
          <button className="rounded bg-ink px-5 py-2.5 text-white">Create bundle</button>
        </form>
      </section>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Existing bundles</h2>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Member</th><th scope="col">Name</th><th scope="col">Price</th><th scope="col">Parts</th></tr></thead>
          <tbody>
            {(bundles ?? []).map((b) => (
              <tr key={b.id} className="border-t">
                <td className="py-2">{b.member?.name}</td>
                <td><Link href={`/console/adverts/bundles/${b.id}`} className="text-graphite hover:underline">{b.name}</Link></td>
                <td>{b.price_pennies != null ? `£${(b.price_pennies / 100).toFixed(2)}` : "—"}</td>
                <td>{b.parts?.[0]?.count ?? 0}</td>
              </tr>
            ))}
            {!bundles?.length && <tr><td colSpan={4} className="py-4 text-center text-graphite">None yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
