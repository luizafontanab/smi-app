import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { SubmitButton } from "@/components/SubmitButton";
import { InvoicePanel } from "@/components/console/InvoicePanel";

// Approved and not over — before approval, approving is what invoices it;
// an ended run (perhaps called off unpaid) isn't re-billed from here.
const BILLABLE_RUN = ["awaiting_payment", "scheduled", "live"];
import { saveSupplierLogo } from "../../../actions";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";

/** Edit one supplier logo run (fix-list 78). `id` is the booking's id. */
export default async function SupplierLogoEditPage(props: PageProps<"/console/adverts/suppliers/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();

  const booking = await must(
    db.from("advert_bookings")
      .select("id, status, starts_on, ends_on, price_pennies, advert:adverts(name, format, mobile_path, link_url, member:members(name))")
      .eq("id", id)
      .maybeSingle(),
    "console/suppliers edit",
  );
  if (!booking || booking.advert?.format !== "supplier_logo") notFound();
  const logo = mediaUrl(booking.advert.mobile_path);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts/suppliers" className="text-sm text-graphite hover:text-ink">← Supplier logos</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Edit supplier logo</h1>
      <p className="mt-1 text-sm text-graphite">
        {booking.advert.member?.name} ·{" "}
        <Link href={`/console/adverts/${booking.id}`} className="underline">booking history and actions</Link>
      </p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveSupplierLogo} className="mt-4 space-y-4 rounded-xl bg-white p-5 text-sm shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={booking.id} />
        <div>
          <label htmlFor="logo" className="text-sm font-medium">Logo</label>
          {logo && <Image src={logo} alt={`Current logo for ${booking.advert.member?.name ?? "this supplier"}`} width={240} height={120} className="mt-1 h-16 w-auto rounded border bg-white p-1" unoptimized />}
          <UploadField id="logo" name="logo" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          <p className="mt-1 text-xs text-graphite">Leave empty to keep the current logo.</p>
        </div>
        <div>
          <label htmlFor="link_url" className="text-sm font-medium">Link (optional)</label>
          <input id="link_url" name="link_url" type="url" defaultValue={booking.advert.link_url ?? ""} placeholder="https://… — blank links to their member page" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">Start<input type="date" name="starts_on" required defaultValue={booking.starts_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="block">End<input type="date" name="ends_on" required defaultValue={booking.ends_on} className="mt-1 block w-full rounded border px-3 py-2" /></label>
          <label className="block">Price (£)
            <input name="price_pounds" inputMode="decimal" placeholder="optional" defaultValue={booking.price_pennies != null ? (booking.price_pennies / 100).toFixed(2) : ""} className="mt-1 block w-full rounded border px-3 py-2" />
          </label>
        </div>
        <p className="text-xs text-graphite">A price added here is invoiced when you save, and held for payment if it hasn&apos;t started. A new price or member on an unpaid invoice replaces it; a paid one isn&apos;t re-billed.</p>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      <InvoicePanel
        target={{ advert_booking_id: booking.id }}
        returnTo={`/console/adverts/suppliers/${booking.id}`}
        raise={{ kind: "booking", id: booking.id, pricePennies: booking.price_pennies, billable: BILLABLE_RUN.includes(booking.status) }}
      />
    </div>
  );
}
