import Link from "next/link";
import type { ReactNode } from "react";
import { formatPounds } from "@/lib/advert-payments";
import { groupBy, placementGroup } from "@/lib/booking-groups";
import { Badge } from "./ui";
import { BookingCard, EmptyRow, HEAD_ROW, PastNote, TABLE } from "./BookingSections";

export type PlacementRow = {
  id: string;
  starts_on: string;
  ends_on: string;
  price_pennies: number | null;
  awaiting_payment: boolean;
  member: { name: string } | null;
};

/** The first column: who or what is booked. Defaults to the member. */
type FirstColumn<T> = { header: string; cell: (row: T) => ReactNode };

/**
 * Booked, then Pending, for placements (Featured Member, Featured Event, Takeover) — same
 * cards as ArtworkRunCards. Placements have no approval step, so Pending is
 * only ever "waiting for payment".
 */
export function PlacementCards<T extends PlacementRow>({
  rows,
  today,
  editBase,
  noun,
  first,
  extra,
}: {
  rows: T[];
  today: string;
  editBase: string;
  noun: string;
  /** replaces the Member column, e.g. Featured Event's event title */
  first?: FirstColumn<T>;
  /** one page-specific column, e.g. the takeover's colour */
  extra?: { header: string; cell: (row: T) => ReactNode };
}) {
  const groups = groupBy(rows, (r) => placementGroup(r, today));
  const byStart = (a: T, b: T) => a.starts_on.localeCompare(b.starts_on);
  const cols = extra ? 7 : 6;
  const lead: FirstColumn<T> = first ?? { header: "Member", cell: (r) => r.member?.name };

  const table = (list: T[], status: (r: T) => ReactNode, empty: string) => (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className="py-1">{lead.header}</th>
            {extra && <th scope="col">{extra.header}</th>}
            <th scope="col">From</th><th scope="col">To</th><th scope="col">Price</th><th scope="col" /><th scope="col" />
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="py-2">{lead.cell(r)}</td>
              {extra && <td>{extra.cell(r)}</td>}
              <td>{r.starts_on}</td>
              <td>{r.ends_on}</td>
              <td>{r.price_pennies != null ? formatPounds(r.price_pennies) : "—"}</td>
              <td>{status(r)}</td>
              <td className="text-right"><Link href={`${editBase}/${r.id}`} className="text-xs text-ink hover:underline">{r.awaiting_payment ? "open" : "edit"}</Link></td>
            </tr>
          ))}
          {!list.length && <EmptyRow colSpan={cols}>{empty}</EmptyRow>}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <BookingCard title="Booked" count={groups.booked.length} hint="Confirmed — running now or booked to run.">
        {table(
          [...groups.booked].sort(byStart),
          (r) => (r.starts_on <= today ? <Badge tone="green">live</Badge> : <span className="text-graphite">upcoming</span>),
          "Nothing booked right now.",
        )}
        <PastNote count={groups.past.length} href="/console/adverts?placements=past#placements" noun={noun} />
      </BookingCard>
      <BookingCard title="Pending" count={groups.pending.length} hint="Not confirmed yet — not on the site until it's paid.">
        {table([...groups.pending].sort(byStart), () => <Badge>waiting for payment</Badge>, "Nothing waiting.")}
      </BookingCard>
    </>
  );
}
