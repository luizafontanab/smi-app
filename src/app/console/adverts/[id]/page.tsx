import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bookingPhase, peakSold } from "@/lib/adverts";
import { bannerInventory } from "@/lib/banner-inventory";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { PHASE_LABELS } from "@/components/console/advert-formats";
import { InvoicePanel } from "@/components/console/InvoicePanel";
import { ApproveBookingFields } from "@/components/console/ApproveBookingFields";
import { holdsForPayment } from "@/lib/advert-payments";
import { bookDraftRun, decideArtworkSwap, decideAdvertBooking, deleteDraftBooking, endBooking, proposeArtworkSwap, renewBooking, updateDraftDates } from "../../actions";
import { UploadField } from "@/components/UploadField";

export const dynamic = "force-dynamic";

export default async function BookingPage(props: PageProps<"/console/adverts/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  await requireConsole();
  const db = serviceDb();
  const today = new Date().toISOString().slice(0, 10);

  // A malformed id would hit Postgres as an invalid uuid (22P02); keep that a
  // 404 rather than letting must() throw it into the error boundary.
  if (!UUID_RE.test(id)) notFound();
  const booking = await must(
    db.from("advert_bookings")
      .select("*, advert:adverts(id, name, format, desktop_path, mobile_path, member:members(name))")
      .eq("id", id)
      .maybeSingle(),
    "console/adverts booking",
  );
  if (!booking) notFound();

  const phase = bookingPhase(booking, today);
  const desktop = mediaUrl(booking.advert?.desktop_path);

  // ad_impression rows are written by /api/seen once the artwork has actually
  // been on screen. Counted over this run's own term, so a re-booked piece of
  // artwork doesn't lend this run the previous one's numbers. Same shape the
  // member's dashboard uses (src/app/dashboard/stats/page.tsx).
  const dayAfterEnd = new Date(Date.parse(`${booking.ends_on}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const [pendingSwap, { count: impressions }] = await Promise.all([
    booking.advert
      ? must(db.from("advert_artwork_proposals").select("id, desktop_path, mobile_path, submitted_at, source").eq("advert_id", booking.advert.id).eq("status", "pending").maybeSingle(), "console/adverts pending swap")
      : Promise.resolve(null),
    booking.advert
      ? mustList(
          db.from("analytics_events").select("id", { count: "exact", head: true })
            .eq("kind", "ad_impression").eq("advert_id", booking.advert.id)
            .gte("occurred_at", booking.starts_on).lt("occurred_at", dayAfterEnd),
          "console/adverts booking impressions",
        )
      : Promise.resolve({ count: null }),
  ]);
  const swapDesktop = mediaUrl(pendingSwap?.desktop_path ?? null);

  // Banner spots are shown, never enforced: say what approving would do to the
  // busiest day of this run, and let Jas decide. Only for a banner still to run.
  const spotCheckFrom = booking.starts_on > today ? booking.starts_on : today;
  const spotCheck = booking.status === "awaiting_approval" && booking.advert?.format === "banner" && booking.ends_on >= today
    ? await bannerInventory(today, "console/adverts booking").then(({ spots, bookings }) => {
        const peak = peakSold(bookings, spotCheckFrom, booking.ends_on);
        return { spots, after: peak.count + 1, day: peak.day ?? spotCheckFrom };
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{booking.advert?.name}</h1>
      <p className="mt-1 text-sm text-graphite">
        {booking.advert?.member?.name} · {booking.advert?.format.replace(/_/g, " ")}
        {booking.price_pennies != null ? ` · £${(booking.price_pennies / 100).toFixed(2)}` : " · unpriced"}
      </p>
      {typeof sp.saved === "string" && <p role="status" className="mt-2 rounded bg-success/10 p-2 text-sm text-success">Saved.</p>}
      {typeof sp.error === "string" && <p role="alert" className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}
      {/* A bundle part is paid through its bundle's invoice, not one of its own. */}
      <InvoicePanel
        target={booking.bundle_id ? { bundle_id: booking.bundle_id } : { advert_booking_id: booking.id }}
        returnTo={`/console/adverts/${booking.id}`}
        // A bundle part's invoice is raised from its bundle's page.
        raise={booking.bundle_id ? undefined : { kind: "booking", id: booking.id, pricePennies: booking.price_pennies, billable: ["awaiting_payment", "scheduled", "live"].includes(booking.status) }}
      />

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="rounded bg-ink/5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink">{PHASE_LABELS[phase]}</span>
          <span className="text-sm text-graphite">{booking.starts_on} → {booking.ends_on}</span>
        </div>
        <p className="mt-2 text-sm text-graphite">
          <span className="font-semibold text-ink tabular-nums">{(impressions ?? 0).toLocaleString("en-GB")}</span> impressions over this run
          {phase === "live" || phase === "upcoming" ? " so far" : ""} — counted only where the reader accepted analytics cookies, so read it as a floor.
        </p>
        {booking.review_reason && (
          <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">Sent back: {booking.review_reason}</p>
        )}
        {booking.ended_at && (
          <p className="mt-3 text-sm text-graphite">
            Ended {String(booking.ended_at).slice(0, 10)} ({booking.ended_reason === "ended_early" ? "ended early" : "term complete"})
            {booking.ended_note ? ` — ${booking.ended_note}` : ""}
          </p>
        )}
        {desktop && <Image src={desktop} alt="" width={640} height={85} className="mt-3 h-auto w-full rounded border" unoptimized />}
      </section>

      {pendingSwap && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Artwork swap awaiting approval</h2>
          <p className="mt-1 text-xs text-graphite">
            Sent {pendingSwap.submitted_at.slice(0, 10)}{pendingSwap.source === "member" ? " by the member" : ""}. Approving replaces the artwork above; the dates don&apos;t change either way.
          </p>
          {swapDesktop && <Image src={swapDesktop} alt="" width={640} height={85} className="mt-3 h-auto w-full rounded border" unoptimized />}
          <form action={decideArtworkSwap} className="mt-3">
            <input type="hidden" name="id" value={pendingSwap.id} />
            <input type="hidden" name="decision" value="approve" />
            <button className="rounded bg-success px-4 py-2 text-sm text-white">Approve swap</button>
          </form>
          <form action={decideArtworkSwap} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={pendingSwap.id} />
            <input type="hidden" name="decision" value="reject" />
            <label htmlFor="swap-reason" className="sr-only">Reason (sent to the member)</label>
            <input id="swap-reason" name="reason" placeholder="What needs changing? (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
            <button className="whitespace-nowrap rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Send back</button>
          </form>
        </section>
      )}

      {booking.status === "awaiting_approval" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Approval</h2>
          {spotCheck && (
            <p className={`mt-2 text-sm ${spotCheck.after > spotCheck.spots ? "font-semibold text-danger" : "text-graphite"}`}>
              Approving puts {spotCheck.after} banner{spotCheck.after === 1 ? "" : "s"} live on {spotCheck.day}
              {spotCheck.after > spotCheck.spots ? ` — over the ${spotCheck.spots} spots we sell.` : ` — within the ${spotCheck.spots} spots we sell.`}
            </p>
          )}
          <form action={decideAdvertBooking} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="approve" />
            {/* A member's request arrives unpriced; this is where the run gets
                its price and the invoice is raised off it (fix-list 77). */}
            <ApproveBookingFields
              defaultPounds={booking.price_pennies != null ? (booking.price_pennies / 100).toFixed(2) : ""}
              pricedHolds={holdsForPayment(1)}
            />
          </form>
          <form action={decideAdvertBooking} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="reject" />
            <label htmlFor="booking-reason" className="sr-only">Reason (sent to the member)</label>
            <input id="booking-reason" name="reason" placeholder="What needs changing? (sent to the member)" required className="w-full rounded border px-3 py-1.5 text-sm" />
            <button className="whitespace-nowrap rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">Send back</button>
          </form>
        </section>
      )}

      {/* A console rebook lands here as a draft (renewBooking): this is where
          it is checked and booked. A member's own draft is theirs to send. */}
      {booking.status === "draft" && booking.source === "admin" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Book this run</h2>
          <p className="mt-1 text-xs text-graphite">Not booked yet — it holds no dates and shows nowhere until you book it.</p>
          {/* GAPS A2.12: the dates can still change, and an unwanted draft can go. */}
          <form action={updateDraftDates} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="id" value={id} />
            <label className="block">Start<input type="date" name="starts_on" required defaultValue={booking.starts_on} className="mt-1 block rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required defaultValue={booking.ends_on} className="mt-1 block rounded border px-3 py-2" /></label>
            <button className="rounded border px-4 py-2">Change dates</button>
          </form>
          <form action={bookDraftRun} className="mt-3">
            <input type="hidden" name="id" value={id} />
            {booking.bundle_id ? (
              <>
                <p className="text-sm text-graphite">Part of a bundle, so it has no price of its own: the bundle&apos;s invoice covers it, and it waits for that to be paid if it isn&apos;t yet.</p>
                <button className="mt-2 rounded bg-success px-4 py-2 text-sm text-white">Book &amp; schedule</button>
              </>
            ) : (
              <ApproveBookingFields
                verb="Book"
                defaultPounds={booking.price_pennies != null ? (booking.price_pennies / 100).toFixed(2) : ""}
                pricedHolds={holdsForPayment(1)}
              />
            )}
          </form>
          <form action={deleteDraftBooking} className="mt-4 flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
            <input type="hidden" name="id" value={id} />
            <label className="flex items-center gap-2 text-graphite">
              <input type="checkbox" name="confirm" value="1" required /> Delete this draft. It was never booked, so nothing else changes.
            </label>
            <button className="rounded border border-danger/30 px-3 py-1.5 text-danger">Delete draft</button>
          </form>
        </section>
      )}

      {(phase === "live" || phase === "upcoming") && !pendingSwap && booking.advert && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Swap the artwork</h2>
          <p className="mt-1 text-xs text-graphite">Applies immediately — you&apos;re doing the swap, so there&apos;s nobody else to approve it.</p>
          <form action={proposeArtworkSwap} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="advert_id" value={booking.advert.id} />
            <input type="hidden" name="booking_id" value={id} />
            <div>
              <label htmlFor="swap-desktop" className="text-xs font-medium">New desktop artwork</label>
              <UploadField id="swap-desktop" name="desktop" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <div>
              <label htmlFor="swap-mobile" className="text-xs font-medium">New mobile artwork</label>
              <UploadField id="swap-mobile" name="mobile" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <button className="sm:col-span-2 rounded bg-ink px-4 py-2 text-sm text-white">Swap now</button>
          </form>
        </section>
      )}

      {(phase === "live" || phase === "upcoming" || phase === "awaiting_payment") && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">{phase === "awaiting_payment" ? "Call off this run" : "End this run early"}</h2>
          {phase === "awaiting_payment" && <p className="mt-1 text-xs text-graphite">It hasn&apos;t been paid for; ending it frees its dates and voids its unpaid invoice.</p>}
          <p className="mt-1 text-xs text-graphite">The booked dates are kept on the record; the advert comes down immediately.</p>
          <form action={endBooking} className="mt-3 flex gap-2">
            <input type="hidden" name="id" value={id} />
            <input name="note" placeholder="Reason (optional, internal)" className="w-full rounded border px-3 py-1.5 text-sm" />
            <button className="whitespace-nowrap rounded border border-danger/30 px-3 py-1.5 text-sm text-danger">End run</button>
          </form>
        </section>
      )}

      {phase === "ended" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Rebook</h2>
          <p className="mt-1 text-xs text-graphite">Same artwork, new dates. Creates a draft you can check before booking.</p>
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
