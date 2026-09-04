import Link from "next/link";
import { notFound } from "next/navigation";
import { bookingPhase } from "@/lib/adverts";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { renewAdvertBooking, resubmitAdvert } from "../../actions";
import { AdvertForm } from "../AdvertForm";
import { ArtworkSwapForm } from "../ArtworkSwapForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your advert" };

const STATUS_COPY: Record<string, string> = {
  draft: "Not sent yet — finish it below and submit when you are ready.",
  awaiting: "With us for approval. We will email you when it is scheduled.",
  changes_needed: "We have asked for a change before this can run.",
  upcoming: "Approved and scheduled — it starts on its start date.",
  live: "Running on the site now.",
  ended: "This run has finished.",
};

export default async function MemberAdvertPage(props: PageProps<"/dashboard/advert/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const user = await requireMember();
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

  const { data: pendingSwap } = canSwap
    ? await db.from("advert_artwork_proposals").select("id, submitted_at").eq("advert_id", booking.advert!.id).eq("status", "pending").maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/advertising/manage" className="text-sm text-graphite hover:text-ink">← Manage adverts</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{booking.advert?.name}</h1>
      <p className="mt-1 text-sm text-graphite">{STATUS_COPY[phase]}</p>
      {typeof sp.error === "string" && <p className="mt-2 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

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
            <dt className="text-graphite">Runs</dt><dd>{booking.starts_on} → {booking.ends_on}</dd>
          </dl>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(booking.advert?.desktop_path)!} alt="" className="mt-4 w-full rounded border" />
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

      {phase === "ended" && (
        <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-ink">Run it again</h2>
          <p className="mt-1 text-xs text-graphite">Same artwork, new dates. It goes back to us for approval.</p>
          <form action={renewAdvertBooking} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
            <input type="hidden" name="id" value={id} />
            <label className="block">Start<input type="date" name="starts_on" required className="mt-1 block rounded border px-3 py-2" /></label>
            <label className="block">End<input type="date" name="ends_on" required className="mt-1 block rounded border px-3 py-2" /></label>
            <button className="rounded bg-ink px-4 py-2 text-white">Request</button>
          </form>
        </section>
      )}
    </div>
  );
}
