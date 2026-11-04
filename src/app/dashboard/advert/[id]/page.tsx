import Link from "next/link";
import { notFound } from "next/navigation";
import { bookingPhase } from "@/lib/adverts";
import { requireMemberView } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { renewAdvertBooking, resubmitAdvert } from "../../actions";
import { AdvertForm } from "../AdvertForm";
import { ArtworkSwapForm } from "../ArtworkSwapForm";
import { RequiredMark } from "@/components/RequiredMark";
import { openInvoiceFor, formatPounds } from "@/lib/advert-payments";
import { canRenewBooking } from "@/lib/advert-renewal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your advert" };

const STATUS_COPY: Record<string, string> = {
  draft: "Not sent yet — finish it below and submit when you are ready.",
  awaiting: "With us for approval. We will email you when it is scheduled.",
  changes_needed: "We have asked for a change before this can run.",
  awaiting_payment: "Approved — it goes live once it's paid. Pay securely by card below.",
  upcoming: "Approved and scheduled — it starts on its start date.",
  live: "Running on the site now.",
  ended: "This run has finished.",
};

export default async function MemberAdvertPage(props: PageProps<"/dashboard/advert/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMemberView();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const { data: booking } = await db
    .from("advert_bookings")
    .select("*, advert:adverts(id, name, format, link_url, desktop_path, mobile_path, member_id)")
    .eq("id", id)
    .single();
  // service role bypasses RLS, so ownership is checked here
  if (!booking || booking.advert?.member_id !== user.memberId) notFound();

  const phase = bookingPhase(booking, today);
  const editable = phase === "draft" || phase === "changes_needed";
  const canSwap = phase === "upcoming" || phase === "live";

  // A held run (6 Oct): its invoice, directly or through its bundle, and the way to pay it.
  const dueInvoice = phase === "awaiting_payment"
    ? await openInvoiceFor(booking.bundle_id ? { bundle_id: booking.bundle_id } : { advert_booking_id: booking.id })
    : null;

  const { data: pendingSwap } = canSwap
    ? await db.from("advert_artwork_proposals").select("id, submitted_at").eq("advert_id", booking.advert!.id).eq("status", "pending").maybeSingle()
    : { data: null };

  const desktopSrc = mediaUrl(booking.advert?.desktop_path);
  const mobileSrc = mediaUrl(booking.advert?.mobile_path);

  return (
    <div className="max-w-2xl lg:mx-auto">
      <Link href="/dashboard/advertising/manage" className="tap text-sm text-graphite hover:text-ink">← Manage adverts</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{booking.advert?.name}</h1>
      <p className="mt-1 text-sm text-graphite">{STATUS_COPY[phase]}</p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      {dueInvoice?.status === "issued" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-brand bg-brand/5 p-4">
          <p className="text-sm text-ink">
            <span className="font-semibold">Payment due: {formatPounds(dueInvoice.amount_pennies)}</span>
            <span className="text-graphite"> · {dueInvoice.number}</span>
          </p>
          <Link href={`/dashboard/pay/invoice/${dueInvoice.id}`} className="tap rounded bg-ink px-4 py-2 text-sm font-semibold text-white">Pay now</Link>
        </div>
      )}

      {booking.review_reason && (
        <div className="mt-4 rounded-xl border-2 border-brand bg-brand/5 p-4">
          <p className="text-sm font-semibold text-ink">What needs changing</p>
          <p className="mt-1 text-sm text-ink">{booking.review_reason}</p>
        </div>
      )}

      {editable ? (
        <AdvertForm
          action={resubmitAdvert}
          bookingId={id}
          submitLabel="Resubmit for approval"
          defaults={{
            name: booking.advert?.name ?? "",
            format: booking.advert?.format ?? "banner",
            linkUrl: booking.advert?.link_url ?? "",
            startsOn: booking.starts_on,
            endsOn: booking.ends_on,
            desktopUrl: mediaUrl(booking.advert?.desktop_path),
            mobileUrl: mediaUrl(booking.advert?.mobile_path),
          }}
        />
      ) : (
        <section className="mt-5 rounded-xl bg-white p-6 shadow-sm">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-graphite">Format</dt><dd>{booking.advert?.format.replace(/_/g, " ")}</dd>
            <dt className="text-graphite">Runs</dt><dd><span className="whitespace-nowrap">{booking.starts_on} →</span> <span className="whitespace-nowrap">{booking.ends_on}</span></dd>
          </dl>
          {/* Both pieces of artwork, labelled: the desktop banner alone shrank to an
              unreadable strip on a phone, and the mobile version phone readers
              actually see was never shown (#33 M15). Mobile leads on phones. */}
          <div className="mt-4 flex flex-col gap-4">
            {desktopSrc && (
              <figure>
                <figcaption className="text-xs font-medium text-graphite">Desktop artwork</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={desktopSrc} alt="" className="mt-1 w-full rounded border" />
              </figure>
            )}
            {mobileSrc && (
              <figure className="order-first sm:order-none">
                <figcaption className="text-xs font-medium text-graphite">Mobile artwork</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mobileSrc} alt="" className="mt-1 w-full max-w-sm rounded border" />
              </figure>
            )}
          </div>
        </section>
      )}

      {canSwap && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Swap the artwork</h2>
          {pendingSwap ? (
            <p className="mt-1 text-sm text-graphite">
              New artwork sent on {pendingSwap.submitted_at.slice(0, 10)} is with us for approval. The dates and the
              artwork above stay as they are until we decide.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-graphite">Same run, same dates — just new images, once we&apos;ve approved them.</p>
              <ArtworkSwapForm advertId={booking.advert!.id} bookingId={id} />
            </>
          )}
        </section>
      )}

      {/* the same rule renewAdvertBooking applies */}
      {canRenewBooking(booking, today) && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Run it again</h2>
          <p className="mt-1 text-xs text-graphite">Same artwork, new dates. It goes back to us for approval.</p>
          <form action={renewAdvertBooking} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="id" value={id} />
            <label className="block">Start<RequiredMark /><input type="date" name="starts_on" required min={today} className="mt-1 block rounded border px-3 py-2 text-base sm:text-sm" /></label>
            <label className="block">End<RequiredMark /><input type="date" name="ends_on" required min={today} className="mt-1 block rounded border px-3 py-2 text-base sm:text-sm" /></label>
            <button className="rounded bg-ink px-4 py-2 text-white">Request</button>
          </form>
        </section>
      )}
    </div>
  );
}
