import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { declineInterest, startAdvertFromInterest } from "../../actions";

export const dynamic = "force-dynamic";

// The four keys /dashboard/buy posts. Kept here rather than imported so the
// member-facing copy and the console label can drift independently.
const PRODUCT_LABELS: Record<string, string> = {
  featured_member: "Featured Member",
  newsletter_slot: "Newsletter slot",
  banner_package: "Banner package",
  featured_machine: "Featured Machine",
};

export default async function AdvertInterestPage() {
  await requireConsole();
  const db = serviceDb();
  const { data: requests } = await db
    .from("visibility_requests")
    .select("id, product, message, status, created_at, member:members(id, name, contact_email)")
    .order("created_at", { ascending: false });

  const open = (requests ?? []).filter((r) => r.status === "requested");
  const handled = (requests ?? []).filter((r) => r.status !== "requested");

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-gray-400 hover:text-ink">← Adverts &amp; Inventory</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Interest</h1>
      <p className="mt-1 text-sm text-gray-500">
        Members who asked about advertising from their dashboard. There is no online payment — you confirm availability and invoice.
      </p>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Waiting on you ({open.length})</h2>
        {open.length === 0 && <p className="mt-2 text-sm text-gray-500">Nothing new.</p>}
        {open.map((r) => (
          <div key={r.id} className="mt-3 rounded border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p>
                <b>{r.member?.name}</b>{" "}
                <span className="text-xs uppercase text-brand">{PRODUCT_LABELS[r.product] ?? r.product}</span>
              </p>
              <span className="text-xs text-gray-400">{String(r.created_at).slice(0, 10)}</span>
            </div>
            {r.message && <p className="mt-1 text-gray-600">{r.message}</p>}
            {r.member?.contact_email && <p className="mt-1 text-xs text-gray-400">{r.member.contact_email}</p>}
            <div className="mt-2 flex gap-2">
              <form action={startAdvertFromInterest}>
                <input type="hidden" name="id" value={r.id} />
                <button className="rounded bg-ink px-3 py-1.5 text-xs text-white">Start artwork for them</button>
              </form>
              <form action={declineInterest}>
                <input type="hidden" name="id" value={r.id} />
                <button className="rounded border px-3 py-1.5 text-xs text-gray-500">Decline</button>
              </form>
            </div>
          </div>
        ))}
      </section>

      {handled.length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Handled</h2>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {handled.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2">{r.member?.name}</td>
                  <td className="text-gray-500">{PRODUCT_LABELS[r.product] ?? r.product}</td>
                  <td className="text-gray-400">{r.status}</td>
                  <td className="text-right text-xs text-gray-400">{String(r.created_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
