import Image from "next/image";
import Link from "next/link";
import { mediaUrl } from "@/lib/db/server";
import { bookingPhase } from "@/lib/adverts";
import { formatPounds } from "@/lib/advert-payments";
import { groupBy, pendingReason, runGroup } from "@/lib/booking-groups";
import { Badge } from "./ui";
import { BookingCard, EmptyRow, HEAD_ROW, PastNote, TABLE } from "./BookingSections";

export type ArtworkRun = {
  id: string;
  status: string;
  starts_on: string;
  ends_on: string;
  price_pennies: number | null;
  advert: { name: string; mobile_path: string | null; member: { name: string } | null } | null;
};

const price = (p: number | null) => (p != null ? formatPounds(p) : "—");

function Thumb({ run }: { run: ArtworkRun }) {
  const src = mediaUrl(run.advert?.mobile_path ?? null);
  return src ? <Image src={src} alt={run.advert?.name ?? ""} width={80} height={40} className="h-8 w-auto" unoptimized /> : <span>—</span>;
}

/**
 * Booked, then Pending, for runs that are an advert plus a booking — the
 * Banners and Supplier Logos pages. The page renders its own "Book a …" form
 * after these, so all five booking pages read the same top to bottom.
 */
export function ArtworkRunCards({
  runs,
  today,
  editBase,
  noun,
}: {
  runs: ArtworkRun[];
  today: string;
  /** e.g. /console/adverts/banners — rows link to `${editBase}/${id}` */
  editBase: string;
  noun: string;
}) {
  const groups = groupBy(runs, (r) => runGroup(r, today));
  const booked = [...groups.booked].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const pending = [...groups.pending].sort((a, b) => a.starts_on.localeCompare(b.starts_on));

  return (
    <>
      <BookingCard title="Booked" count={booked.length} hint="Confirmed — running now or booked to run.">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr className={HEAD_ROW}><th scope="col" className="py-1">Artwork</th><th scope="col">Member</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Price</th><th scope="col" /><th scope="col" /></tr></thead>
            <tbody>
              {booked.map((r) => {
                const live = bookingPhase(r, today) === "live";
                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-2"><Thumb run={r} /></td>
                    <td>{r.advert?.member?.name}</td>
                    <td>{r.starts_on}</td>
                    <td>{r.ends_on}</td>
                    <td>{price(r.price_pennies)}</td>
                    <td>{live ? <Badge tone="green">live</Badge> : <span className="text-graphite">upcoming</span>}</td>
                    <td className="text-right"><Link href={`${editBase}/${r.id}`} className="text-xs text-ink hover:underline">edit</Link></td>
                  </tr>
                );
              })}
              {!booked.length && <EmptyRow colSpan={7}>Nothing booked right now.</EmptyRow>}
            </tbody>
          </table>
        </div>
        <PastNote count={groups.past.length} href="/console/adverts?phase=ended" noun={noun} />
      </BookingCard>

      <BookingCard title="Pending" count={pending.length} hint="Not confirmed yet — not on the site until it is.">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr className={HEAD_ROW}><th scope="col" className="py-1">Artwork</th><th scope="col">Member</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Price</th><th scope="col">Waiting on</th><th scope="col" /></tr></thead>
            <tbody>
              {pending.map((r) => {
                // Approval happens on the booking's own page; everything else is edited here.
                const needsApproval = r.status === "awaiting_approval";
                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-2"><Thumb run={r} /></td>
                    <td>{r.advert?.member?.name}</td>
                    <td>{r.starts_on}</td>
                    <td>{r.ends_on}</td>
                    <td>{price(r.price_pennies)}</td>
                    <td><Badge tone={needsApproval ? "brand" : "neutral"}>{pendingReason(r, today)}</Badge></td>
                    <td className="text-right">
                      <Link href={needsApproval ? `/console/adverts/${r.id}` : `${editBase}/${r.id}`} className="text-xs text-ink hover:underline">
                        {needsApproval ? "review" : "open"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!pending.length && <EmptyRow colSpan={7}>Nothing waiting.</EmptyRow>}
            </tbody>
          </table>
        </div>
      </BookingCard>
    </>
  );
}
