import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bookingPhase } from "@/lib/adverts";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { decideArtworkSwap, decideAdvertBooking, endBooking, proposeArtworkSwap, renewBooking } from "../../actions";

export const dynamic = "force-dynamic";

const PHASE_LABELS: Record<string, string> = {
  draft: "Draft", awaiting: "Awaiting approval", changes_needed: "Changes needed",
  upcoming: "Scheduled", live: "Live", ended: "Ended",
};

export default async function BookingPage(props: PageProps<"/console/adverts/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  const { data: booking } = await db
    .from("advert_bookings")
    .select("*, advert:adverts(id, name, format, desktop_path, mobile_path, member:members(name)), product:advert_products(short_name)")
    .eq("id", id)
    .single();
  if (!booking) notFound();

  const phase = bookingPhase(booking, today);
  const desktop = mediaUrl(booking.advert?.desktop_path);

  const { data: pendingSwap } = booking.advert
    ? await db.from("advert_artwork_proposals").select("id, desktop_path, mobile_path, submitted_at, source").eq("advert_id", booking.advert.id).eq("status", "pending").maybeSingle()
    : { data: null };
  const swapDesktop = mediaUrl(pendingSwap?.desktop_path ?? null);

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/console/adverts" className="text-sm text-gray-500 hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{booking.advert?.name}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {booking.advert?.member?.name} · {booking.advert?.format.replace(/_/g, " ")}
        {booking.product?.short_name ? ` · sold as ${booking.product.short_name}` : ""}
      </p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-600">{sp.error}</p>}

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="rounded bg-ink/5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink">{PHASE_LABELS[phase]}</span>
          <span className="text-sm text-gray-500">{booking.starts_on} → {booking.ends_on}</span>
        </div>
        {booking.review_reason && (
          <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">Sent back: {booking.review_reason}</p>
        )}
        {booking.ended_at && (
          <p className="mt-3 text-sm text-gray-500">
            Ended {String(booking.ended_at).slice(0, 10)} ({booking.ended_reason === "ended_early" ? "ended early" : "term complete"})
            {booking.ended_note ? ` — ${booking.ended_note}` : ""}
          </p>
        )}
        {desktop && <Image src={desktop} alt="" width={640} height={85} className="mt-3 h-auto w-full rounded border" unoptimized />}
      </section>

      {pendingSwap && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Artwork swap awaiting approval</h2>
          <p className="mt-1 text-xs text-gray-500">
            Sent {pendingSwap.submitted_at.slice(0, 10)}{pendingSwap.source === "member" ? " by the member" : ""}. Approving replaces the artwork above; the dates don&apos;t change either way.
          </p>
          {swapDesktop && <Image src={swapDesktop} alt="" width={640} height={85} className="mt-3 h-auto w-full rounded border" unoptimized />}
          <form action={decideArtworkSwap} className="mt-3">
            <input type="hidden" name="id" value={pendingSwap.id} />
            <input type="hidden" name="decision" value="approve" />
            <button className="rounded bg-green-600 px-4 py-2 text-sm text-white">Approve swap</button>
          </form>
          <form action={decideArtworkSwap} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={pendingSwap.id} />
            <input type="hidden" name="decision" value="reject" />
            <label htmlFor="swap-reason" className="sr-only">Reason (sent to the member)</label>
            <input id="swap-reason" name="reason" placeholder="What needs changing? (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
            <button className="whitespace-nowrap rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Send back</button>
          </form>
        </section>
      )}

      {booking.status === "awaiting_approval" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Approval</h2>
          <p className="mt-1 text-xs text-gray-500">Approving schedules it; it goes live on its start date.</p>
          <form action={decideAdvertBooking} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="approve" />
            <button className="rounded bg-green-600 px-4 py-2 text-sm text-white">Approve &amp; schedule</button>
          </form>
          <form action={decideAdvertBooking} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="reject" />
            <label htmlFor="booking-reason" className="sr-only">Reason (sent to the member)</label>
            <input id="booking-reason" name="reason" placeholder="What needs changing? (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
            <button className="whitespace-nowrap rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">Send back</button>
          </form>
        </section>
      )}

      {(phase === "live" || phase === "upcoming") && !pendingSwap && booking.advert && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Swap the artwork</h2>
          <p className="mt-1 text-xs text-gray-500">Applies immediately — you&apos;re doing the swap, so there&apos;s nobody else to approve it.</p>
          <form action={proposeArtworkSwap} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="advert_id" value={booking.advert.id} />
            <input type="hidden" name="booking_id" value={id} />
            <div>
              <label className="text-xs font-medium">New desktop artwork</label>
              <input name="desktop" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">New mobile artwork</label>
              <input name="mobile" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <button className="sm:col-span-2 rounded bg-ink px-4 py-2 text-sm text-white">Swap now</button>
          </form>
        </section>
      )}

      {(phase === "live" || phase === "upcoming") && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">End this run early</h2>
          <p className="mt-1 text-xs text-gray-500">The booked dates are kept on the record; the advert comes down immediately.</p>
          <form action={endBooking} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input name="note" placeholder="Reason (optional, internal)" className="w-full rounded border px-3 py-1.5 text-sm" />
            <button className="whitespace-nowrap rounded border border-red-300 px-3 py-1.5 text-sm text-red-600">End run</button>
          </form>
        </section>
      )}

      {phase === "ended" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Rebook</h2>
          <p className="mt-1 text-xs text-gray-500">Same artwork, new dates. Creates a draft you can check before booking.</p>
          <form action={renewBooking} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="id" value={id} />
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block rounded border px-3 py-2" /></label>
            <button className="rounded bg-ink px-4 py-2 text-white">Create draft</button>
          </form>
        </section>
      )}
    </div>
  );
}
