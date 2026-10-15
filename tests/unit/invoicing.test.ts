import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureInvoice, invoiceNumber, isPayableOnline, raiseInvoice } from "@/lib/invoicing";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

function db(invoices: ReturnType<typeof queryBuilder>) {
  const from = fromByTable({ invoices: () => invoices });
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

const callsOf = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls;
const numberTaken = () => dbError('duplicate key value violates unique constraint "invoices_number_key"', { code: "23505" });
const itemTaken = () => dbError('duplicate key value violates unique constraint "invoices_one_issued_per_booking"', { code: "23505" });

describe("invoiceNumber", () => {
  // Review finding 5: SMI-<prefix>-<ms base36> collided for two invoices in one millisecond.
  it("differs for two invoices raised in the same millisecond, keeping the recognisable shape", () => {
    const at = new Date("2026-10-16T09:00:00Z");
    const numbers = new Set(Array.from({ length: 50 }, () => invoiceNumber("ADV", at)));
    expect(numbers.size).toBe(50);
    for (const n of numbers) expect(n).toMatch(/^SMI-ADV-[0-9A-Z]+-[0-9A-Z]{4}$/);
    expect(invoiceNumber("JOIN", at)).toMatch(/^SMI-JOIN-/);
  });
});

describe("isPayableOnline", () => {
  // Review finding 10: membership invoices were payable by direct URL.
  it("is true for advertising and visibility invoices only", () => {
    expect(isPayableOnline({ number: "SMI-ADV-MG3K2Q-4K9Z" })).toBe(true);
    expect(isPayableOnline({ number: "SMI-VIS-MG3K2Q" })).toBe(true);
    expect(isPayableOnline({ number: "SMI-JOIN-MG3K2Q" })).toBe(false);
    expect(isPayableOnline({ number: "SMI-2026-100" })).toBe(false); // the seed's membership rows
  });
});

describe("raiseInvoice", () => {
  it("retries with a fresh number when the number is already taken", async () => {
    let n = 0;
    const invoices = queryBuilder(() => (n++ === 0 ? numberTaken() : dbOk({ id: "inv1" })));
    db(invoices);

    const raised = await raiseInvoice("m1", 1000, "VIS", { description: "Visibility: x" });

    expect(raised).toEqual({ id: "inv1", number: expect.stringMatching(/^SMI-VIS-/) });
    const [first, second] = callsOf(invoices.insert).map(([row]) => (row as { number: string }).number);
    expect(first).not.toBe(second);
  });

  it("returns null (and logs) for an item that already has an issued invoice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db(queryBuilder(itemTaken()));
    expect(await raiseInvoice("m1", 1000, "ADV", { advert_booking_id: "b1" })).toBeNull();
  });
});

describe("ensureInvoice", () => {
  const existing = { id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 65000, status: "issued" };

  it("returns the item's existing invoice without raising another", async () => {
    const invoices = queryBuilder(dbOk([existing]));
    db(invoices);

    expect(await ensureInvoice("m1", 65000, "ADV", { advert_booking_id: "b1" }))
      .toEqual({ ok: true, created: false, invoice: { id: "inv1", number: "SMI-ADV-1" } });
    expect(invoices.eq).toHaveBeenCalledWith("advert_booking_id", "b1");
    expect(invoices.in).toHaveBeenCalledWith("status", ["issued", "paid"]);
    expect(invoices.insert).not.toHaveBeenCalled();
  });

  it("raises one when there is none", async () => {
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.insert).length ? dbOk({ id: "inv2" }) : dbOk([])));
    db(invoices);

    expect(await ensureInvoice("m1", 65000, "ADV", { bundle_id: "bd1", description: "Bundle" }))
      .toEqual({ ok: true, created: true, invoice: { id: "inv2", number: expect.stringMatching(/^SMI-ADV-/) } });
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({ bundle_id: "bd1", status: "issued", amount_pennies: 65000 }));
  });

  it("resolves a concurrent duplicate to the invoice that won the race", async () => {
    // read (none yet) → insert (loses to the other request) → read (the winner)
    const results = [dbOk([]), itemTaken(), dbOk([existing])];
    let call = 0;
    const invoices = queryBuilder(() => results[Math.min(call++, results.length - 1)]);
    db(invoices);

    expect(await ensureInvoice("m1", 65000, "ADV", { advert_booking_id: "b1" }))
      .toEqual({ ok: true, created: false, invoice: { id: "inv1", number: "SMI-ADV-1" } });
  });

  it("refuses when the invoice on record is for a different amount — void it first", async () => {
    const invoices = queryBuilder(dbOk([{ ...existing, amount_pennies: 50000 }]));
    db(invoices);

    expect(await ensureInvoice("m1", 65000, "ADV", { advert_booking_id: "b1" }))
      .toEqual({ ok: false, error: expect.stringContaining("void it") });
    expect(invoices.insert).not.toHaveBeenCalled();
  });

  it("refuses when the invoice on record is another member's (a held slot changed hands)", async () => {
    db(queryBuilder(dbOk([{ ...existing, member_id: "m2" }])));
    expect(await ensureInvoice("m1", 65000, "ADV", { placement_id: "pl1" })).toMatchObject({ ok: false });
  });

  it("needs exactly one link and a positive amount", async () => {
    const from = db(queryBuilder());
    expect(await ensureInvoice("m1", 65000, "ADV", {})).toMatchObject({ ok: false });
    expect(await ensureInvoice("m1", 65000, "ADV", { advert_booking_id: "b1", bundle_id: "bd1" })).toMatchObject({ ok: false });
    expect(await ensureInvoice("m1", 0, "ADV", { advert_booking_id: "b1" })).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a failed insert as an error, not as nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const invoices = queryBuilder((): DbResult => (callsOf(invoices.insert).length ? dbError("disk full") : dbOk([])));
    db(invoices);
    expect(await ensureInvoice("m1", 65000, "ADV", { advert_booking_id: "b1" }))
      .toEqual({ ok: false, error: expect.stringContaining("disk full") });
  });
});
