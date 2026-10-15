import { requireMember } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { signedInvoiceUrl } from "@/lib/invoice-pdf";
import Link from "next/link";
import { advertPaymentsMode } from "@/lib/adapters/advert-checkout";
import { cancelMembership } from "../../actions";
import { SettingsTabs } from "../SettingsTabs";
import { CancelMembershipDialog } from "./CancelMembershipDialog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingSettingsPage(props: PageProps<"/dashboard/settings/billing">) {
  const user = await requireMember();
  const sp = await props.searchParams;
  const db = serviceDb();
  const [{ data: invoices }, { data: member }] = await Promise.all([
    db.from("invoices").select("id, number, description, amount_pennies, issued_on, status, pdf_path").eq("member_id", user.memberId).order("issued_on", { ascending: false }),
    db.from("members").select("billing_mode, joined_at, status, cancel_requested_at").eq("id", user.memberId).single(),
  ]);

  // Invoices live in a private bucket (they carry name + amount); each render
  // signs a short-lived URL per PDF. Ownership is already enforced by the
  // member_id scope on the invoices query above.
  // Advertising invoices can be paid online (6 Oct); membership is paid by
  // its own subscription and is never "issued" here waiting on the member.
  const payable = advertPaymentsMode() !== "off";
  const pdfUrls = new Map<string, string | null>();
  await Promise.all(
    (invoices ?? [])
      .filter((i) => i.pdf_path)
      .map(async (i) => pdfUrls.set(i.number, await signedInvoiceUrl(i.pdf_path!)))
  );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Billing</h1>
      <p className="mt-1 text-sm text-graphite">
        £40/month membership · member since {member?.joined_at} · paid by {member?.billing_mode === "card" ? "card (Stripe)" : "invoice"}.
        Advertising invoices are listed here too, and can be paid by card.
      </p>
      <SettingsTabs active="billing" />
      {sp.cancelled === "1" && (
        <p className="mt-3 rounded bg-brand/10 p-2 text-sm text-ink">Cancellation scheduled — see below.</p>
      )}
      {typeof sp.cerror === "string" && (
        <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.cerror}</p>
      )}

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Invoices</h2>
        <div className="overflow-x-auto mt-2">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="text-left text-xs uppercase text-graphite"><th scope="col" className="py-1">Invoice</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col" /></tr></thead>
          <tbody>
            {(invoices ?? []).map((i) => (
              <tr key={i.number} className="border-t">
                <td className="py-2">
                  <span className="font-medium">{i.number}</span>
                  {i.description && <span className="block text-xs text-graphite">{i.description}</span>}
                </td>
                <td>{i.issued_on}</td>
                <td>£{(i.amount_pennies / 100).toFixed(2)}</td>
                <td>
                  {i.status === "paid"
                    ? <span className="text-success">paid</span>
                    : i.status === "issued" && payable && !i.number.startsWith("SMI-JOIN-")
                      ? <Link href={`/dashboard/pay/invoice/${i.id}`} className="rounded bg-ink px-3 py-1 text-xs font-semibold text-white">Pay now</Link>
                      : i.status === "issued" ? "unpaid" : i.status}
                </td>
                <td className="text-right">
                  {i.pdf_path && pdfUrls.get(i.number)
                    ? <a href={pdfUrls.get(i.number)!} className="text-xs text-graphite underline">download</a>
                    : <span className="text-xs text-graphite">PDF soon</span>}
                </td>
              </tr>
            ))}
            {(invoices ?? []).length === 0 && <tr><td colSpan={5} className="py-3 text-graphite">No invoices yet.</td></tr>}
          </tbody>
        </table>
        </div>
      </section>

      {member?.status === "active" && (
        <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Cancel membership</h2>
          {member.cancel_requested_at ? (
            <p className="mt-2 text-sm text-graphite">
              Cancellation requested on {member.cancel_requested_at.slice(0, 10)} — your membership stays active for
              the rest of the current billing period and won&apos;t renew after that. Contact SMI if you&apos;ve
              changed your mind.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-graphite">
                You&apos;ll keep access through the end of your current billing period — nothing is cut off immediately.
              </p>
              <CancelMembershipDialog action={cancelMembership} joinedAt={member?.joined_at ?? null} />
            </>
          )}
        </section>
      )}
    </div>
  );
}
