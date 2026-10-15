"use client";

import { useState } from "react";

/**
 * The price field and Approve button on a booking awaiting approval. The
 * button says what approving will actually do with the price as typed — it
 * used to read "Approve & schedule" whatever the price, while a priced run
 * with payments on is held for payment instead (decideAdvertBooking).
 *
 * `pricedHolds` is holdsForPayment() for any positive price, decided on the
 * server: false when payments are off, where a priced run schedules straight
 * away with an invoice for Jas to collect by hand.
 *
 * `verb` is "Book" on a console renewal's draft (bookDraftRun), which has the
 * same outcomes but is Jas's own booking rather than a member's request.
 */
export function ApproveBookingFields({ defaultPounds, pricedHolds, verb = "Approve" }: { defaultPounds: string; pricedHolds: boolean; verb?: "Approve" | "Book" }) {
  const [pounds, setPounds] = useState(defaultPounds);
  const priced = Number(pounds.replace(/[£,\s]/g, "")) > 0;
  const label = !priced ? `${verb} & schedule` : pricedHolds ? `${verb} & send the invoice` : `${verb}, schedule & invoice`;
  const outcome = !priced
    ? "Schedules it now; it goes live on its start date."
    : pricedHolds
      ? "Raises the invoice and emails the member the pay link. It stays off the site until they pay, then goes live on its start date."
      : "Schedules it now and raises an invoice for you to collect by hand.";

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-sm">Price (£)
          <input
            name="price_pounds"
            inputMode="decimal"
            placeholder="blank = invoice by hand"
            value={pounds}
            onChange={(e) => setPounds(e.currentTarget.value)}
            className="mt-1 block w-44 rounded border px-3 py-1.5"
          />
        </label>
        <button aria-describedby="approve-outcome" className="rounded bg-success px-4 py-2 text-sm text-white">{label}</button>
      </div>
      <p id="approve-outcome" className="mt-1 text-xs text-graphite">{outcome}</p>
    </>
  );
}
