import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { monthLabel, monthLast } from "@/lib/featured-availability";
import { declineInterest, startAdvertFromInterest } from "../../actions";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// The four keys /dashboard/advertising/buy posts (lib/visibility-products.ts).
// Kept here rather than imported so the member-facing copy and the console
// label can drift independently.
const PRODUCT_LABELS: Record<string, string> = {
  featured_member: "Featured Member",
  newsletter_slot: "Newsletter slot",
  banner_package: "Banner package",
  featured_machine: "Featured Machine",
};

export default async function AdvertInterestPage(props: PageProps<"/console/adverts/interest">) {
  await requireConsole();
  const sp = await props.searchParams;
  const db = serviceDb();
  const requests = await must(
    db.from("visibility_requests")
      .select("id, product, message, preferred_month, status, created_at, member:members(id, name, contact_email)")
      .order("created_at", { ascending: false }),
    "console/adverts interest list",
  );

  const open = (requests ?? []).filter((r) => r.status === "requested");
  const handled = (requests ?? []).filter((r) => r.status !== "requested");

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Interest</h1>
      <p className="mt-1 text-sm text-graphite">
        Members who asked about advertising from their dashboard. You confirm availability and set the amount; the member can pay that invoice by card from their billing page.
      </p>
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Waiting on you ({open.length})</h2>
        {open.length === 0 && <p className="mt-2 text-sm text-graphite">Nothing new.</p>}
        {open.map((r) => (
          <div key={r.id} className="mt-3 rounded border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p>
                <b>{r.member?.name}</b>{" "}
                <span className="text-xs uppercase text-brand">{PRODUCT_LABELS[r.product] ?? r.product}</span>
              </p>
              <span className="text-xs text-graphite">{String(r.created_at).slice(0, 10)}</span>
            </div>
            {r.preferred_month && (
              <p className="mt-1">
                Wants: <b>{monthLabel(r.preferred_month)}</b>
                {r.product === "featured_member" && r.member?.id && (
                  <>
                    {" · "}
                    <Link
                      href={`/console/adverts/featured-member?${new URLSearchParams({
                        member_id: r.member.id,
                        starts_on: r.preferred_month,
                        ends_on: monthLast(r.preferred_month),
                      })}`}
                      className="font-semibold text-ink underline"
                    >
                      Book this slot →
                    </Link>
                  </>
                )}
              </p>
            )}
            {r.message && <p className="mt-1 text-graphite">{r.message}</p>}
            {r.member?.contact_email && <p className="mt-1 text-xs text-graphite">{r.member.contact_email}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <form action={startAdvertFromInterest} className="flex items-center gap-1.5">
                <input type="hidden" name="id" value={r.id} />
                <span aria-hidden="true" className="text-xs text-graphite">£</span>
                <label htmlFor={`interest-amount-${r.id}`} className="sr-only">Amount in pounds</label>
                <input id={`interest-amount-${r.id}`} name="amount_pounds" type="number" step="0.01" min="0.30" max="999999.99" required placeholder="0.00" className="w-20 rounded border px-1.5 py-1 text-xs" />
                <SubmitButton className="rounded bg-ink px-3 py-1.5 text-xs text-white" pendingLabel="Confirming…">Confirm &amp; invoice</SubmitButton>
              </form>
              <form action={declineInterest}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton className="rounded border px-3 py-1.5 text-xs text-graphite" pendingLabel="Declining…">Decline</SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </section>

      {handled.length > 0 && (
        <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Handled</h2>
          <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs uppercase text-graphite">
                <th scope="col" className="py-1">Member</th>
                <th scope="col">Product</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {handled.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2">{r.member?.name}</td>
                  <td className="text-graphite">{PRODUCT_LABELS[r.product] ?? r.product}</td>
                  <td className="text-graphite">{r.status}</td>
                  <td className="text-right text-xs text-graphite">{String(r.created_at).slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </section>
      )}
    </div>
  );
}
