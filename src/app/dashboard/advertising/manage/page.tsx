import Link from "next/link";
import { bookingPhase } from "@/lib/adverts";
import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { MEMBER_ADVERT_PHASE } from "@/lib/advert-phase-labels";
import { visibilityProductName } from "@/lib/visibility-products";
import { monthLabel } from "@/lib/featured-availability";
import { AdvertisingTabs } from "../AdvertisingTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage advertising" };

const REQUEST_STATUS: Record<string, { label: string; className: string }> = {
  requested: { label: "requested — Jas will confirm", className: "text-brand-text" },
  confirmed: { label: "confirmed", className: "text-success" },
  declined: { label: "declined", className: "text-graphite" },
};

export default async function AdvertisingManagePage() {
  const user = await requireMemberView();
  const db = serviceDb();
  const [{ data: bookings }, { data: requests }] = await Promise.all([
    // Adverts belong to the member, and their run carries the state — so this
    // asks the bookings table, filtered through the member's own artwork.
    // Unfiltered by status (A2.5): scheduled/live/ended runs need to reach
    // the member too, not just the pre-approval statuses.
    db.from("advert_bookings")
      .select("id, status, review_reason, starts_on, ends_on, advert:adverts!inner(name, member_id)")
      .eq("advert.member_id", user.memberId)
      .order("created_at", { ascending: false }),
    db.from("visibility_requests")
      .select("id, product, message, preferred_month, status, created_at")
      .eq("member_id", user.memberId)
      .order("created_at", { ascending: false }),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Manage advertising</h1>
      <p className="mt-1 text-sm text-graphite">Your banner runs and visibility requests, newest first.</p>
      <AdvertisingTabs active="manage" />

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Your adverts</h2>
        {/* Every phase links to its own page — /dashboard/advert/[id] already
            handles artwork-swap (upcoming/live) and "Run it again" (ended). */}
        {(bookings ?? []).map((b) => {
          const phase = bookingPhase(b, today);
          const p = MEMBER_ADVERT_PHASE[phase];
          return (
            <p key={b.id} className="mt-2 border-t pt-2 text-sm">
              <Link href={`/dashboard/advert/${b.id}`} className="hover:underline">{b.advert?.name}</Link> —{" "}
              <span className={p.className}>
                {p.label}{phase === "changes_needed" && b.review_reason && `: ${b.review_reason}`}
              </span>
              <span className="text-graphite"> · {b.starts_on} → {b.ends_on}</span>
            </p>
          );
        })}
        {(bookings ?? []).length === 0 && (
          <p className="mt-2 text-sm text-graphite">
            No adverts yet — <Link href="/dashboard/advertising/buy" className="text-graphite underline">book your first one</Link>.
          </p>
        )}
      </section>

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Your visibility requests</h2>
        {(requests ?? []).map((r) => {
          const s = REQUEST_STATUS[r.status] ?? { label: r.status, className: "text-graphite" };
          return (
            <p key={r.id} className="mt-2 border-t pt-2 text-sm">
              {visibilityProductName(r.product)} — <span className={s.className}>{s.label}</span>
              <span className="text-graphite"> · {r.created_at.slice(0, 10)}{r.preferred_month && ` · for ${monthLabel(r.preferred_month)}`}{r.message &&` · “${r.message}”`}</span>
            </p>
          );
        })}
        {(requests ?? []).length === 0 && (
          <p className="mt-2 text-sm text-graphite">
            Nothing requested yet — see what&apos;s on offer under <Link href="/dashboard/advertising/buy" className="text-graphite underline">Buy</Link>.
          </p>
        )}
      </section>
    </div>
  );
}
