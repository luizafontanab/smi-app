import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bookingPhase } from "@/lib/adverts";
import { requireConsole } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must, mustList } from "@/lib/db/must";
import { UUID_RE } from "@/lib/validate";
import { PHASE_LABELS } from "@/components/console/advert-formats";
import { decideArtworkSwap, decideAdvertBooking, endBooking, proposeArtworkSwap, renewBooking } from "../../actions";

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
      .select("*, advert:adverts(id, name, format, desktop_path, mobile_path, member:members(name)), product:advert_products(short_name)")
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

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/console/adverts" className="text-sm text-graphite hover:text-ink">← Bookings</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{booking.advert?.name}</h1>
      <p className="mt-1 text-sm text-graphite">
        {booking.advert?.member?.name} · {booking.advert?.format.replace(/_/g, " ")}
        {booking.product?.short_name ? ` · sold as ${booking.product.short_name}` : ""}
      </p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

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
          <p className="mt-1 text-xs text-graphite">Approving schedules it; it goes live on its start date.</p>
          <form action={decideAdvertBooking} className="mt-3">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="approve" />
            <button className="rounded bg-success px-4 py-2 text-sm text-white">Approve &amp; schedule</button>
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

      {(phase === "live" || phase === "upcoming") && !pendingSwap && booking.advert && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Swap the artwork</h2>
          <p className="mt-1 text-xs text-graphite">Applies immediately — you&apos;re doing the swap, so there&apos;s nobody else to approve it.</p>
          <form action={proposeArtworkSwap} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="advert_id" value={booking.advert.id} />
            <input type="hidden" name="booking_id" value={id} />
            <div>
              <label htmlFor="swap-desktop" className="text-xs font-medium">New desktop artwork</label>
              <input id="swap-desktop" name="desktop" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <div>
              <label htmlFor="swap-mobile" className="text-xs font-medium">New mobile artwork</label>
              <input id="swap-mobile" name="mobile" type="file" accept="image/jpeg,image/png,image/webp" required className="mt-1 w-full text-sm" />
            </div>
            <button className="sm:col-span-2 rounded bg-ink px-4 py-2 text-sm text-white">Swap now</button>
          </form>
        </section>
      )}

      {(phase === "live" || phase === "upcoming") && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">End this run early</h2>
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
