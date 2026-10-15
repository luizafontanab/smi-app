import Link from "next/link";
import type { ReactNode } from "react";
import { Card, SectionTitle } from "./ui";

/**
 * The shared skeleton of the Banners, Supplier Logos, Featured Member,
 * Takeover and Bundles pages: Booked, then Pending, then the new-booking form,
 * each in the same card with the same heading. Keeping it in one component is
 * what keeps the five pages the same shape.
 */
export function BookingCard({
  title,
  count,
  hint,
  children,
  className = "mt-4",
}: {
  title: string;
  count?: number;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <SectionTitle>
        {title}
        {count !== undefined && <span className="text-sm font-normal text-graphite tabular-nums">({count})</span>}
      </SectionTitle>
      {hint && <p className="mt-1 text-xs text-graphite">{hint}</p>}
      <div className="mt-3">{children}</div>
    </Card>
  );
}

/** One line under Booked: past runs are counted and linked, never listed here. */
export function PastNote({ count, href, noun }: { count: number; href: string; noun: string }) {
  if (!count) return null;
  return (
    <p className="mt-3 text-xs text-graphite">
      {count} past {noun}{count === 1 ? "" : "s"} —{" "}
      <Link href={href} className="underline">see them on Bookings</Link>.
    </p>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="py-4 text-center text-graphite">{children}</td></tr>;
}

export const TABLE = "w-full text-sm min-w-[560px]";
export const HEAD_ROW = "text-left text-xs uppercase text-graphite";
