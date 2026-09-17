import { afterEach, describe, expect, it, vi } from "vitest";
import { raiseInvoice } from "@/lib/invoicing";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
});

describe("raiseInvoice", () => {
  it("inserts an issued invoice with a prefixed number and today's date", async () => {
    const invoices = queryBuilder(dbOk(null));
    const from = vi.fn(() => invoices);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    await raiseInvoice("mem1", 4000, "ADV");

    expect(from).toHaveBeenCalledWith("invoices");
    expect(invoices.insert).toHaveBeenCalledWith(expect.objectContaining({
      member_id: "mem1",
      amount_pennies: 4000,
      // These land 'issued', never 'paid' — Jas invoices advert work manually.
      status: "issued",
      number: expect.stringMatching(/^SMI-ADV-[0-9A-Z]+$/),
      issued_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });

  it("carries the VIS prefix for a visibility request", async () => {
    const invoices = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => invoices })));

    await raiseInvoice("mem1", 25000, "VIS");

    expect(invoices.insert).toHaveBeenCalledWith(
      expect.objectContaining({ number: expect.stringMatching(/^SMI-VIS-/) }),
    );
  });

  it.each([0, -1])("raises nothing for an amount of %i, and never touches the database", async (amount) => {
    // A £0 line is a console mistake, not an invoice. Writing one would put a
    // zero-value row in front of a member with no way to clear it.
    const from = vi.fn(() => queryBuilder(dbOk(null)));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    await raiseInvoice("mem1", amount, "ADV");

    expect(from).not.toHaveBeenCalled();
  });
});
