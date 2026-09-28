import Image from "next/image";
import Link from "next/link";
import { bookingPhase } from "@/lib/adverts";
import { MEMBER_ADVERT_PHASE } from "@/lib/advert-phase-labels";
import { requireMember } from "@/lib/auth";
import { mediaUrl, serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { ADVERT_FORMATS } from "@/components/console/advert-formats";
import { AdvertisingTabs } from "../AdvertisingTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your advertising assets" };

const MACHINE_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "draft", className: "text-graphite" },
  awaiting_approval: { label: "awaiting approval", className: "text-brand-text" },
  published: { label: "approved", className: "text-success" },
  rejected: { label: "needs a change", className: "text-danger" },
  withdrawn: { label: "withdrawn", className: "text-graphite" },
};

// Only these can still be edited by the member (A4.17) — the same list the
// equipment edit page enforces.
const MACHINE_EDITABLE = new Set(["awaiting_approval", "rejected"]);

const formatLabel = (format: string) => ADVERT_FORMATS.find((f) => f.value === format)?.label ?? format;

/**
 * Every piece of advertising a member has given SMI, with where it stands
 * (GAPS A9.8, REQUIREMENTS §6, 18 Sep). Manage lists *runs*; this lists the
 * *things* — each piece of artwork once, with all its runs under it, plus the
 * member's Featured Machine listings (and their video, A9.4).
 *
 * Read-only by design: every action already lives on its own page, and each
 * row links there rather than duplicating the forms.
 */
export default async function AdvertisingAssetsPage() {
  const user = await requireMember();
  const db = serviceDb();
  const [adverts, machines] = await Promise.all([
    must(
      db.from("adverts")
        .select("id, name, format, desktop_path, mobile_path, created_at, bookings:advert_bookings(id, status, review_reason, starts_on, ends_on)")
        .eq("member_id", user.memberId)
        .order("created_at", { ascending: false }),
      "dashboard/advertising/assets adverts",
    ),
    must(
      db.from("featured_machines")
        .select("id, name, status, image_path, video_url, rejected_reason, created_at")
        .eq("member_id", user.memberId)
        .order("created_at", { ascending: false }),
      "dashboard/advertising/assets machines",
    ),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mt-1 text-xl font-bold text-ink">Your advertising assets</h1>
      <p className="mt-1 text-sm text-graphite">Every piece of artwork and every equipment listing you&apos;ve given us, and where each one stands.</p>
      <AdvertisingTabs active="assets" />

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm" aria-labelledby="assets-artwork">
        <h2 id="assets-artwork" className="font-bold text-ink">Advert artwork</h2>
        {(adverts ?? []).length === 0 && (
          <p className="mt-2 text-sm text-graphite">
            No artwork yet — <Link href="/dashboard/advertising/buy" className="underline">book your first advert</Link>.
          </p>
        )}
        <ul>
          {(adverts ?? []).map((a) => {
            const thumb = mediaUrl(a.desktop_path) ?? mediaUrl(a.mobile_path);
            const runs = [...(a.bookings ?? [])].sort((x, y) => y.starts_on.localeCompare(x.starts_on));
            return (
              <li key={a.id} className="mt-3 flex gap-4 border-t pt-3">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-graphite/10">
                  {thumb && <Image src={thumb} alt="" width={96} height={56} className="h-full w-full object-contain" unoptimized />}
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-ink">{a.name}</p>
                  <p className="text-xs text-graphite">
                    {formatLabel(a.format)}
                    {!a.mobile_path && a.format !== "skyscraper" && " · no mobile version"}
                  </p>
                  {runs.length === 0 ? (
                    <p className="mt-1 text-graphite">Not booked yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {runs.map((b) => {
                        const phase = bookingPhase(b, today);
                        const p = MEMBER_ADVERT_PHASE[phase];
                        return (
                          <li key={b.id}>
                            <Link href={`/dashboard/advert/${b.id}`} className="hover:underline">
                              {b.starts_on} → {b.ends_on}
                            </Link>{" "}
                            — <span className={p.className}>{p.label}{phase === "changes_needed" && b.review_reason && `: ${b.review_reason}`}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-5 rounded-xl bg-white p-5 shadow-sm" aria-labelledby="assets-machines">
        <h2 id="assets-machines" className="font-bold text-ink">Equipment listings</h2>
        {(machines ?? []).length === 0 && (
          <p className="mt-2 text-sm text-graphite">
            None yet — <Link href="/dashboard/equipment/new" className="underline">list a machine</Link>.
          </p>
        )}
        <ul>
          {(machines ?? []).map((m) => {
            const s = MACHINE_STATUS[m.status] ?? { label: m.status, className: "text-graphite" };
            const photo = mediaUrl(m.image_path);
            return (
              <li key={m.id} className="mt-3 flex gap-4 border-t pt-3">
                <div className="h-14 w-24 shrink-0 overflow-hidden rounded bg-graphite/10">
                  {photo && <Image src={photo} alt="" width={96} height={56} className="h-full w-full object-cover" unoptimized />}
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold text-ink">{m.name}</p>
                  <p>
                    <span className={s.className}>{s.label}{m.status === "rejected" && m.rejected_reason && `: ${m.rejected_reason}`}</span>
                    <span className="text-graphite"> · {m.video_url ? "with video" : "no video"}</span>
                  </p>
                  {MACHINE_EDITABLE.has(m.status) && (
                    <Link href={`/dashboard/equipment/${m.id}/edit`} className="text-xs underline">Edit</Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
