import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { saveFeaturedMemberPlacement } from "../../actions";

export const dynamic = "force-dynamic";

export default async function FeaturedMemberPage(props: PageProps<"/console/adverts/featured-member">) {
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: members }, { data: booked }] = await Promise.all([
    db.from("members").select("id, name").eq("status", "active").order("name"),
    db.from("placements").select("id, starts_on, ends_on, member:members(name)").eq("kind", "featured_member").order("starts_on", { ascending: false }),
  ]);
  const liveCount = (booked ?? []).filter((p) => p.starts_on <= today && p.ends_on >= today).length;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts" className="text-sm text-gray-500 hover:text-ink">← Adverts &amp; Inventory</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Featured Member</h1>
      <p className="mt-1 text-sm text-gray-500">
        Homepage carousel slot, by the month. Up to {FEATURED_SLOTS.cap} can run at once — {liveCount} live today.
      </p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Book a slot</h2>
        <form action={saveFeaturedMemberPlacement} className="mt-3 space-y-4 text-sm">
          <div>
            <label htmlFor="member_id" className="text-sm font-medium">Member</label>
            <select id="member_id" name="member_id" required className="mt-1 w-full rounded border px-3 py-2">
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block w-full rounded border px-3 py-2" /></label>
          </div>
          <button className="rounded bg-ink px-5 py-2.5 text-white">Book slot</button>
        </form>
      </section>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Booked</h2>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-gray-500"><th scope="col" className="py-1">Member</th><th scope="col">From</th><th scope="col">To</th><th scope="col" /></tr></thead>
          <tbody>
            {(booked ?? []).map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-2">{p.member?.name}</td>
                <td>{p.starts_on}</td>
                <td>{p.ends_on}</td>
                <td className="text-right">{p.starts_on <= today && p.ends_on >= today && <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">live</span>}</td>
              </tr>
            ))}
            {!booked?.length && <tr><td colSpan={4} className="py-4 text-center text-gray-500">None booked yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  );
}
