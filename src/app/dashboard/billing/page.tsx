import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const user = await requireMember();
  const db = serviceDb();
  const [{ data: invoices }, { data: member }] = await Promise.all([
    db.from("invoices").select("number, amount_pennies, issued_on, status, pdf_path").eq("member_id", user.memberId).order("issued_on", { ascending: false }),
    db.from("members").select("billing_mode, joined_at, status").eq("id", user.memberId).single(),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard" className="text-sm text-gray-400 hover:text-ink">← Dashboard</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">Billing</h1>
      <p className="mt-1 text-sm text-gray-500">
        £40/month membership · member since {member?.joined_at} · paid by {member?.billing_mode === "card" ? "card (Stripe)" : "invoice"}.
      </p>
      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Invoices</h2>
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-gray-400"><th className="py-1">Invoice</th><th>Date</th><th>Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(invoices ?? []).map((i) => (
              <tr key={i.number} className="border-t">
                <td className="py-2 font-medium">{i.number}</td>
                <td>{i.issued_on}</td>
                <td>£{(i.amount_pennies / 100).toFixed(2)}</td>
                <td>{i.status === "paid" ? <span className="text-green-600">paid</span> : i.status}</td>
                <td className="text-right">
                  {i.pdf_path
                    ? <a href={i.pdf_path} className="text-xs text-graphite underline">download</a>
                    : <span className="text-xs text-gray-300">PDF soon</span>}
                </td>
              </tr>
            ))}
            {(invoices ?? []).length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
