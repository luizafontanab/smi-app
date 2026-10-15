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
import { saveBannerRun } from "../../../actions";

export const dynamic = "force-dynamic";

/** Edit one banner run from the Banners page. `id` is the booking's id; same shape as the supplier logo editor. */
export default async function BannerRunEditPage(props: PageProps<"/console/adverts/banners/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  if (!UUID_RE.test(id)) notFound();
  const db = serviceDb();

  const booking = await must(
    db.from("advert_bookings")
      .select("id, status, starts_on, ends_on, price_pennies, advert:adverts(name, format, desktop_path, mobile_path, link_url, member:members(name))")
      .eq("id", id)
      .maybeSingle(),
    "console/banners edit",
  );
  if (!booking || !booking.advert || !["banner", "banner_narrow"].includes(booking.advert.format)) notFound();
  const desktop = mediaUrl(booking.advert.desktop_path);
  const mobile = mediaUrl(booking.advert.mobile_path);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/console/adverts/banners" className="text-sm text-graphite hover:text-ink">← Banners</Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Edit banner</h1>
      <p className="mt-1 text-sm text-graphite">
        {booking.advert.member?.name} ·{" "}
        <Link href={`/console/adverts/${booking.id}`} className="underline">booking history and actions</Link>
      </p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <form action={saveBannerRun} className="mt-4 space-y-4 rounded-xl bg-white p-5 text-sm shadow-sm">
        <UnsavedChangesGuard />
        <input type="hidden" name="id" value={booking.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="desktop" className="text-sm font-medium">Desktop image</label>
            {desktop && <Image src={desktop} alt="Current desktop banner" width={1280} height={170} className="mt-1 h-auto w-full rounded border" unoptimized />}
            <input id="desktop" name="desktop" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          </div>
          <div>
            <label htmlFor="mobile" className="text-sm font-medium">Mobile image</label>
            {mobile && <Image src={mobile} alt="Current mobile banner" width={370} height={280} className="mt-1 h-auto w-40 rounded border" unoptimized />}
            <input id="mobile" name="mobile" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 w-full text-sm" />
          </div>
        </div>
        <p className="text-xs text-graphite">Leave a file empty to keep that image.</p>
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
        <p className="text-xs text-graphite">Changing the price here records it on the run; it doesn&apos;t raise or change an invoice.</p>
        <SubmitButton pendingLabel="Saving…" className="rounded bg-ink px-5 py-2.5 text-white disabled:opacity-50">Save</SubmitButton>
      </form>
      <InvoicePanel target={{ advert_booking_id: booking.id }} returnTo={`/console/adverts/banners/${booking.id}`} />
    </div>
  );
}
