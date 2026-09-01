import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { signedInvoiceUrl } from "@/lib/invoice-pdf";
import { cancelMembership } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingPage(props: PageProps<"/dashboard/billing">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();
  const [{ data: invoices }, { data: member }] = await Promise.all([
    db.from("invoices").select("number, amount_pennies, issued_on, status, pdf_path").eq("member_id", user.memberId).order("issued_on", { ascending: false }),
    db.from("members").select("billing_mode, joined_at, status, cancel_requested_at").eq("id", user.memberId).single(),
  ]);

  // Invoices live in a private bucket (they carry name + amount); each render
  // signs a short-lived URL per PDF. Ownership is already enforced by the
  // member_id scope on the invoices query above.
  const pdfUrls = new Map<string, string | null>();
  await Promise.all(
    (invoices ?? [])
      .filter((i) => i.pdf_path)
      .map(async (i) => pdfUrls.set(i.number, await signedInvoiceUrl(i.pdf_path!)))
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-500 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Billing</h1>
      <p className="mt-1 text-sm text-gray-500">
        £40/month membership · member since {member?.joined_at} · paid by {member?.billing_mode === "card" ? "card (Stripe)" : "invoice"}.
      </p>
      {sp.cancelled === "1" && (
        <p className="mt-3 rounded bg-brand/10 p-2 text-sm text-gray-700">Cancellation scheduled — see below.</p>
      )}
      {typeof sp.cerror === "string" && (
        <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-600">{sp.cerror}</p>
      )}

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Invoices</h2>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-gray-500"><th scope="col" className="py-1">Invoice</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col" /></tr></thead>
          <tbody>
            {(invoices ?? []).map((i) => (
              <tr key={i.number} className="border-t">
                <td className="py-2 font-medium">{i.number}</td>
                <td>{i.issued_on}</td>
                <td>£{(i.amount_pennies / 100).toFixed(2)}</td>
                <td>{i.status === "paid" ? <span className="text-green-600">paid</span> : i.status}</td>
                <td className="text-right">
                  {i.pdf_path && pdfUrls.get(i.number)
                    ? <a href={pdfUrls.get(i.number)!} className="text-xs text-graphite underline">download</a>
                    : <span className="text-xs text-gray-500">PDF soon</span>}
                </td>
              </tr>
            ))}
            {(invoices ?? []).length === 0 && <tr><td colSpan={5} className="py-3 text-gray-500">No invoices yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </section>

      {member?.status === "active" && (
        <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Cancel membership</h2>
          {member.cancel_requested_at ? (
            <p className="mt-2 text-sm text-gray-600">
              Cancellation requested on {member.cancel_requested_at.slice(0, 10)} — your membership stays active for
              the rest of the current billing period and won&apos;t renew after that. Contact SMI if you&apos;ve
              changed your mind.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-500">
                You&apos;ll keep access through the end of your current billing period — nothing is cut off immediately.
              </p>
              <form action={cancelMembership} className="mt-3 flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" required />
                  confirm
                </label>
                <button className="rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                  Cancel my membership
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
