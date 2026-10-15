import { vi } from "vitest";
import { dbOk, queryBuilder, type DbResult } from "./supabase";

/**
 * The `invoices` table as the payments code reads and writes it
 * (lib/invoicing ensureInvoice, lib/advert-payments voidInvoices, the
 * console's item-billing invoiceOnRecord) — for console action tests that go
 * through those helpers for real rather than mocking them.
 *
 * queryBuilder() doesn't filter, and these helpers ask the table several
 * differently-shaped questions in one action, so each from("invoices") gets a
 * fresh builder that answers by what *that* query asked:
 *
 *   insert                    → { id: insertId }            (the raised invoice)
 *   update                    → the voided row(s), and from then on nothing is on record
 *   .eq("status", "paid")     → the record if it's paid
 *   .eq("status", "issued")   → the record if it's issued   (voidInvoices' read)
 *   anything else             → [the record] or []          (ensureInvoice / invoiceOnRecord)
 *
 *   const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 3000, status: "issued" });
 *   db({ invoices: invoices.factory, ... });
 *   expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
 */

type Builder = ReturnType<typeof queryBuilder>;

export type InvoiceRow = { id: string; number: string; member_id: string; amount_pennies: number; status: "issued" | "paid" };

export const callsOf = (b: Builder, method: string) => vi.mocked(b[method] as (...a: unknown[]) => unknown).mock.calls;
export const calledWith = (b: Builder, method: string, ...args: unknown[]) =>
  callsOf(b, method).some((c) => JSON.stringify(c) === JSON.stringify(args));

export function invoicesTable(initial: InvoiceRow | null = null, insertId = "inv-new") {
  const builders: Builder[] = [];
  let onRecord = initial;
  const factory = () => {
    const b: Builder = queryBuilder((): DbResult => {
      if (callsOf(b, "insert").length) return dbOk({ id: insertId });
      if (callsOf(b, "update").length) {
        const voided = onRecord ? [{ id: onRecord.id }] : [];
        onRecord = null;
        return dbOk(voided);
      }
      if (calledWith(b, "eq", "status", "paid")) return dbOk(onRecord?.status === "paid" ? [{ id: onRecord.id }] : []);
      if (calledWith(b, "eq", "status", "issued")) return dbOk(onRecord?.status === "issued" ? [{ id: onRecord.id, checkout_session_id: null }] : []);
      return dbOk(onRecord ? [onRecord] : []);
    });
    builders.push(b);
    return b;
  };
  return {
    factory,
    inserts: () => builders.flatMap((b) => callsOf(b, "insert").map((c) => c[0])),
    updates: () => builders.flatMap((b) => callsOf(b, "update").map((c) => c[0])),
  };
}

/** A table whose lookups return `row` and whose updates return what they changed (`[]` = matched nothing). */
export function rowThenUpdated(row: Record<string, unknown> | null, updated: { id: string }[] = row ? [{ id: String(row.id) }] : []) {
  const b: Builder = queryBuilder((): DbResult => (callsOf(b, "update").length ? dbOk(updated) : dbOk(row)));
  return b;
}
