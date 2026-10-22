import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookDraftRun, decideAdvertBooking, deleteDraftBooking, endBooking, markInvoicePaid, renewBooking, saveBooking, saveBundle, saveBundleBooking, updateDraftDates } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { calledWith, callsOf, invoicesTable, rowThenUpdated, type InvoiceRow } from "../stubs/invoices-table";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

type Expire = { ok: true } | { ok: false; status: string | null; error: string };
const { requireConsole, enqueue, expireCheckoutSession } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  enqueue: vi.fn(async () => {}),
  // as the real one answers with no Stripe key; a test overrides it per call
  expireCheckoutSession: vi.fn(async (): Promise<Expire> => ({ ok: false, status: null, error: "Online payments are not configured." })),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/jobs", () => ({ enqueue, runQueuedJobSoon: vi.fn() }));
vi.mock("@/lib/adapters/advert-checkout", async (orig) => ({ ...(await orig<typeof import("@/lib/adapters/advert-checkout")>()), expireCheckoutSession }));

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockReset().mockResolvedValue(undefined);
  vi.unstubAllEnvs();
});

// Advert payments run "simulated" under test (no Stripe keys, not production),
// so a priced run is held — pinned here so a key in .env.local can't change that.
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>, rpc?: (...args: unknown[]) => unknown) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from, rpc })));
  return from;
}

type Builder = ReturnType<typeof queryBuilder>;
const calls = callsOf;
const called = calledWith;

describe("saveBooking", () => {
  // fix-list 77: the price is on the booking — there is no rate card to read.
  it("records the price on the run and invoices off it", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert: { member_id: "m1" } }));
    const invoices = invoicesTable();
    const from = db({ advert_bookings: () => bookingsBuilder, invoices: invoices.factory });

    // Succeeds by redirecting with ?saved=1 now — a booking that worked used to
    // be pixel-identical to one that was rejected (fix-list 73's convention).
    await expect(saveBooking(form({ advert_id: "ad1", price_pounds: "650.50", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?saved=1/);

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 65050, status: "awaiting_payment" }));
    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.not.objectContaining({ product_id: expect.anything() }));
    expect(invoices.inserts()).toEqual([expect.objectContaining({ member_id: "m1", amount_pennies: 65050 })]);
    expect(from).not.toHaveBeenCalledWith("advert_products");
  });

  // Review finding 16 Oct: the run was written held and the failed invoice
  // ignored — no pay link anywhere, and Jas told "Saved".
  it("a failed invoice is said on the run's page, where Raise invoice is", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert: { member_id: "m1" } })), invoices: () => queryBuilder(dbError("boom")) });
    await expect(saveBooking(form({ advert_id: "ad1", price_pounds: "650", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/b1\?error=Saved%2C%20but%20the%20invoice%20couldn't%20be%20raised/);
  });

  it("leaves a run unpriced and uninvoiced when the price is blank", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert: { member_id: "m1" } }));
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder });

    await expect(saveBooking(form({ advert_id: "ad1", price_pounds: "", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?saved=1/);

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: null, status: "scheduled" }));
    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
  });

  it("refuses a price that isn't an amount, without booking", async () => {
    const from = db({});
    await expect(saveBooking(form({ advert_id: "ad1", price_pounds: "six hundred", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?error=Enter%20the%20price/);
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a friendlier message for an overlapping run", async () => {
    db({ advert_bookings: () => queryBuilder(dbError("conflicts with advert_bookings_no_overlap constraint")) });

    await expect(saveBooking(form({ advert_id: "ad1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?error=That%20advert%20already%20has%20a%20run/);
  });
});

describe("endBooking", () => {
  it("does nothing for a booking that doesn't exist", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk(null)) });
    await expect(endBooking(form({ id: "b1" }))).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("ends the run and notifies the member, without touching its dates", async () => {
    const bookingsBuilder = rowThenUpdated({ id: "b1", status: "live", ends_on: "2026-09-30", bundle_id: null, advert: { member_id: "m1" } });
    db({ advert_bookings: () => bookingsBuilder });

    await endBooking(form({ id: "b1", note: "Client requested early end" }));

    const [payload] = (bookingsBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ status: "ended", ended_reason: "ended_early", ended_note: "Client requested early end" });
    expect(payload).not.toHaveProperty("ends_on");
    // conditional on the status it was read in
    expect(bookingsBuilder.eq).toHaveBeenCalledWith("status", "live");
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_ended" }));
  });

  it("can call off a run held for payment, voiding its own unpaid invoice", async () => {
    const bookingsBuilder = rowThenUpdated({ id: "b1", status: "awaiting_payment", ends_on: "2026-12-31", bundle_id: null, advert: { member_id: "m1" } });
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 3000, status: "issued" });
    db({ advert_bookings: () => bookingsBuilder, invoices: invoices.factory });

    await endBooking(form({ id: "b1" }));

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
  });

  // Review finding 16 Oct: the bill was voided whatever the run had been — so
  // calling off a live run Jas invoices by hand (payments off) lost its bill.
  it("calling off a scheduled or live run leaves its invoice standing", async () => {
    for (const status of ["scheduled", "live"]) {
      const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 3000, status: "issued" });
      const from = db({ advert_bookings: () => rowThenUpdated({ id: "b1", status, ends_on: "2026-12-31", bundle_id: null, advert: { member_id: "m1" } }), invoices: invoices.factory });
      await endBooking(form({ id: "b1" }));
      expect(invoices.updates()).toEqual([]);
      expect(from).not.toHaveBeenCalledWith("invoices");
    }
  });

  it("a held bundle part checks whether the bundle's one invoice is now abandoned", async () => {
    const invoices = invoicesTable({ id: "invB", number: "SMI-ADV-B", member_id: "m1", amount_pennies: 20000, status: "issued" });
    const parts = queryBuilder((): DbResult => (calls(parts, "update").length ? dbOk([{ id: "b1" }]) : calls(parts, "in").length ? dbOk(null, 0) : dbOk({ id: "b1", status: "awaiting_payment", ends_on: "2026-12-31", bundle_id: "bd1", advert: { member_id: "m1" } })));
    db({ advert_bookings: () => parts, invoices: invoices.factory });

    await endBooking(form({ id: "b1" }));

    // no part left owing → the bundle's invoice is voided
    expect(invoices.updates()).toContainEqual(expect.objectContaining({ status: "void" }));
  });

  it("says so when the member was paying at that moment, instead of claiming the bill is cancelled", async () => {
    // Stripe reports the open checkout already completed — voidInvoices leaves it issued
    expireCheckoutSession.mockResolvedValueOnce({ ok: false, status: "complete", error: "already paid" });
    const invoices = queryBuilder((): DbResult => dbOk([{ id: "inv1", checkout_session_id: "cs_1" }]));
    db({ advert_bookings: () => rowThenUpdated({ id: "b1", status: "awaiting_payment", ends_on: "2026-12-31", bundle_id: null, advert: { member_id: "m1" } }), invoices: () => invoices });

    await expect(endBooking(form({ id: "b1" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/b1\?error=.*paying/);
    expect(invoices.update).not.toHaveBeenCalled();
  });

  it("is idempotent — does not re-notify when a double submit finds nothing left to end", async () => {
    db({ advert_bookings: () => queryBuilder(() => {
      return dbOk(null); // both the lookup and the conditional update return nothing
    }) });

    await endBooking(form({ id: "b1" }));

    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("saveBundle", () => {
  // fix-list 76: these were bare returns, so a failed save looked like nothing happened.
  it("sends a missing member or name back with a reason, writing nothing", async () => {
    const from = db({});
    await expect(saveBundle(form({ member_id: "", name: "Spring set" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/bundles\?error=/);
    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/bundles\/bd1\?error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("updates an existing bundle in place and says so", async () => {
    const builder = queryBuilder(dbOk({ id: "bd1", member_id: "m1", name: "Spring set", price_pennies: 15000 }));
    db({ bundles: () => builder, invoices: invoicesTable().factory, advert_bookings: () => queryBuilder(dbOk(null, 0)) });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "150" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/bundles/bd1?saved=1");

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 15000 }));
  });

  it("reports a failed update instead of claiming it saved", async () => {
    db({ bundles: () => queryBuilder(dbError("boom")) });
    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/bundles\/bd1\?error=That%20couldn't%20be%20saved/);
  });

  it("creates a new bundle and redirects to it", async () => {
    const builder = queryBuilder(dbOk({ id: "bd1" }));
    db({ bundles: () => builder });

    await expect(saveBundle(form({ member_id: "m1", name: "Spring set" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/bundles/bd1");
  });
});

// Review finding 16 Oct (user decision: build it): edits never invoiced, so a
// bundle priced after its first parts were booked was never billed.
describe("saveBundle — the bundle's invoice follows its price", () => {
  const bundleRow = (price: number | null) => () => queryBuilder(dbOk({ id: "bd1", member_id: "m1", name: "Spring set", price_pennies: price }));

  it("a price added to a bundle with parts raises its invoice and holds the parts that haven't started", async () => {
    const invoices = invoicesTable();
    const parts = queryBuilder(dbOk(null, 2));
    db({ bundles: bundleRow(15000), invoices: invoices.factory, advert_bookings: () => parts });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "150" }))).rejects.toThrow(/bd1\?saved=1/);

    expect(invoices.inserts()).toEqual([expect.objectContaining({ bundle_id: "bd1", amount_pennies: 15000, member_id: "m1" })]);
    expect(parts.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_payment" }));
    expect(parts.eq).toHaveBeenCalledWith("status", "scheduled");
    expect(parts.gt).toHaveBeenCalledWith("starts_on", expect.any(String));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due" }));
  });

  it("a new price on an unpaid invoice voids it and raises one at the new price", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 10000, status: "issued" });
    db({ bundles: bundleRow(15000), invoices: invoices.factory, advert_bookings: () => queryBuilder(dbOk(null, 2)) });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "150" }))).rejects.toThrow(/bd1\?saved=1/);

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(invoices.inserts()).toEqual([expect.objectContaining({ amount_pennies: 15000 })]);
  });

  it("a new price on a paid bundle is recorded, not billed — and Jas is told", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 10000, status: "paid" });
    db({ bundles: bundleRow(15000), invoices: invoices.factory, advert_bookings: () => queryBuilder(dbOk(null, 2)) });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "150" })))
      .rejects.toThrow(/bd1\?error=Saved\.%20SMI-ADV-1%20was%20already%20paid/);
    expect(invoices.inserts()).toEqual([]);
    expect(invoices.updates()).toEqual([]);
  });

  it("taking the price off voids the unpaid invoice and releases the held parts", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 10000, status: "issued" });
    const parts = queryBuilder(dbOk(null, 2));
    db({ bundles: bundleRow(null), invoices: invoices.factory, advert_bookings: () => parts });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "" }))).rejects.toThrow(/bd1\?saved=1/);

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(parts.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(parts.eq).toHaveBeenCalledWith("status", "awaiting_payment");
  });

  it("a different member can't take over a paid bundle — refused before anything is written", async () => {
    const bundles = bundleRow(10000)();
    db({ bundles: () => bundles, invoices: invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 10000, status: "paid" }).factory });
    await expect(saveBundle(form({ id: "bd1", member_id: "m2", name: "Spring set", price_pounds: "100" })))
      .rejects.toThrow(/bd1\?error=SMI-ADV-1%20has%20already%20been%20paid/);
    expect(bundles.update).not.toHaveBeenCalled();
  });
});

describe("saveBundleBooking", () => {
  it("requires at least one piece of artwork", async () => {
    await expect(saveBundleBooking(form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/Pick%20at%20least%20one%20piece%20of%20artwork/);
  });

  const bundle = () => queryBuilder(dbOk({ id: "bd1", member_id: "m1", name: "Spring set", price_pennies: 20000 }));

  it("invoices once for the whole bundle on its first booking, holding the parts", async () => {
    const invoices = invoicesTable();
    const parts = queryBuilder(dbOk(null, 2));
    db({ bundles: bundle, advert_bookings: () => parts, invoices: invoices.factory });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad1");
    fd.append("advert_ids", "ad2");
    await saveBundleBooking(fd);

    expect(parts.insert).toHaveBeenCalledWith([expect.objectContaining({ status: "awaiting_payment" }), expect.objectContaining({ status: "awaiting_payment" })]);
    expect(invoices.inserts()).toEqual([expect.objectContaining({ member_id: "m1", amount_pennies: 20000, bundle_id: "bd1" })]);
  });

  it("does not invoice again when the bundle already has its invoice — later parts join the hold", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 20000, status: "issued" });
    const parts = queryBuilder(dbOk(null, 2));
    db({ bundles: bundle, advert_bookings: () => parts, invoices: invoices.factory });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad3");
    await saveBundleBooking(fd);

    expect(parts.insert).toHaveBeenCalledWith([expect.objectContaining({ status: "awaiting_payment" })]);
    expect(invoices.inserts()).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a paid bundle's later parts run on that payment — not held, not billed again", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 20000, status: "paid" });
    const parts = queryBuilder(dbOk(null, 2));
    db({ bundles: bundle, advert_bookings: () => parts, invoices: invoices.factory });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad3");
    await saveBundleBooking(fd);

    expect(parts.insert).toHaveBeenCalledWith([expect.objectContaining({ status: "scheduled" })]);
    expect(invoices.inserts()).toEqual([]);
  });

  // Review finding 7: two first batches booked at once both saw no parts, and
  // both raised a full-price invoice. Now the second resolves to the first's.
  it("two first batches at once: the losing insert resolves to the winner's invoice, with no second email", async () => {
    let inserted = false;
    const winner: InvoiceRow = { id: "inv-first", number: "SMI-ADV-FIRST", member_id: "m1", amount_pennies: 20000, status: "issued" };
    const invoices = () => {
      const b: Builder = queryBuilder((): DbResult => {
        if (calls(b, "insert").length) { inserted = true; return dbError('duplicate key value violates unique constraint "invoices_one_issued_per_bundle"', { code: "23505" }); }
        if (called(b, "eq", "status", "paid")) return dbOk([]);
        // nothing on record before this batch's insert; the winner's row after it
        return dbOk(inserted ? [winner] : []);
      });
      return b;
    };
    db({ bundles: bundle, advert_bookings: () => queryBuilder(dbOk(null, 2)), invoices });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad1");
    await expect(saveBundleBooking(fd)).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due" }));
  });

  it("a failed bundle invoice is said on the bundle's page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ bundles: bundle, advert_bookings: () => queryBuilder(dbOk(null, 2)), invoices: () => queryBuilder(dbError("boom")) });
    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad1");
    await expect(saveBundleBooking(fd)).rejects.toThrow(/bundles\/bd1\?error=Saved%2C%20but%20the%20invoice/);
  });

  it("reports one overlap as failing the whole batch", async () => {
    db({
      bundles: () => queryBuilder(dbOk({ member_id: "m1", price_pennies: null })),
      advert_bookings: () => queryBuilder(dbError("advert_bookings_no_overlap violated")),
    });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad1");
    await expect(saveBundleBooking(fd)).rejects.toThrow(/whole%20batch%20was%20not%20booked/);
  });
});

describe("decideAdvertBooking", () => {
  it("ignores a booking that isn't awaiting approval", async () => {
    const from = db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", status: "scheduled" })) });
    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  it("requires a reason to send changes back", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", advert: { member_id: "m1" }, price_pennies: null })) });

    await expect(decideAdvertBooking(form({ id: "b1", decision: "reject" })))
      .rejects.toThrow(/Give%20the%20member%20a%20reason/);
  });

  // 6 Oct: a priced run is held until paid, and the member gets a pay link
  // instead of "scheduled".
  const awaiting = (extra: Record<string, unknown> = {}) =>
    rowThenUpdated({ id: "b1", status: "awaiting_approval", starts_on: "2026-11-01", ends_on: "2026-11-30", price_pennies: 3000, advert: { member_id: "m1", name: "Autumn banner" }, ...extra });

  it("approving a priced run holds it for payment, invoices it, and sends the pay link", async () => {
    const bookingsBuilder = awaiting();
    const invoices = invoicesTable(null, "inv1");
    db({ advert_bookings: () => bookingsBuilder, invoices: invoices.factory, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_payment", price_pennies: 3000, approved_at: expect.any(String) }));
    expect(invoices.inserts()).toEqual([expect.objectContaining({
      amount_pennies: 3000, advert_booking_id: "b1", description: "Advert: Autumn banner (2026-11-01 to 2026-11-30)",
    })]);
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due", invoice_id: "inv1", amount: "£30.00", booking_id: "b1" }));
    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
  });

  // Review finding 16 Oct: the status guard was a read, the update wasn't
  // conditional — a double-clicked Approve raised two invoices and two emails.
  it("a second Approve that finds the run already decided changes nothing: no invoice, no email, no audit row", async () => {
    // the read still says awaiting_approval (the first click hasn't landed yet);
    // the conditional update matches nothing
    const bookingsBuilder = rowThenUpdated({ id: "b1", status: "awaiting_approval", starts_on: "2026-11-01", ends_on: "2026-11-30", price_pennies: 3000, advert: { member_id: "m1", name: "Autumn banner" } }, []);
    const approvals = queryBuilder(dbOk(null));
    const from = db({ advert_bookings: () => bookingsBuilder, approvals: () => approvals });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.eq).toHaveBeenCalledWith("status", "awaiting_approval");
    expect(from).not.toHaveBeenCalledWith("invoices");
    expect(enqueue).not.toHaveBeenCalled();
    expect(approvals.insert).not.toHaveBeenCalled();
  });

  it("the same for a second Send back", async () => {
    const approvals = queryBuilder(dbOk(null));
    db({ advert_bookings: () => rowThenUpdated({ id: "b1", status: "awaiting_approval", advert: { member_id: "m1" }, price_pennies: null }, []), approvals: () => approvals });
    await decideAdvertBooking(form({ id: "b1", decision: "reject", reason: "New artwork please" }));
    expect(enqueue).not.toHaveBeenCalled();
    expect(approvals.insert).not.toHaveBeenCalled();
  });

  it("an approval whose invoice fails is approved, and says so on the run's page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ advert_bookings: () => awaiting(), invoices: () => queryBuilder(dbError("boom")), approvals: () => queryBuilder(dbOk(null)) });
    await expect(decideAdvertBooking(form({ id: "b1", decision: "approve" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/b1\?error=Saved%2C%20but%20the%20invoice/);
  });

  it("approving an unpriced run schedules it straight away", async () => {
    const bookingsBuilder = awaiting({ price_pennies: null });
    db({ advert_bookings: () => bookingsBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
  });

  it("with payments off in production, a priced run schedules as before and Jas invoices by hand", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const bookingsBuilder = awaiting();
    const invoices = invoicesTable(null, "inv1");
    db({ advert_bookings: () => bookingsBuilder, invoices: invoices.factory, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(invoices.inserts()).toHaveLength(1);
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due" }));
  });

  it("prices a member's unpriced request from the approve form, and invoices that", async () => {
    const bookingsBuilder = awaiting({ price_pennies: null });
    const invoices = invoicesTable();
    db({ advert_bookings: () => bookingsBuilder, invoices: invoices.factory, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve", price_pounds: "420" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 42000 }));
    expect(invoices.inserts()).toEqual([expect.objectContaining({ amount_pennies: 42000 })]);
  });

  it("approving with the price cleared raises no invoice", async () => {
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({
      advert_bookings: () => queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", price_pennies: 3000, advert: { member_id: "m1" } })),
      invoices: () => invoicesBuilder,
      approvals: () => queryBuilder(dbOk(null)),
    });

    await decideAdvertBooking(form({ id: "b1", decision: "approve", price_pounds: "" }));

    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
  });

  it("an overlap on approval reports the error rather than writing a false approval record", async () => {
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({
      advert_bookings: () => queryBuilder(dbError("advert_bookings_no_overlap")),
      approvals: () => approvalsBuilder,
    });
    // select().single() and the update both hit "advert_bookings" — the select
    // needs a real row first, so route it through a sequence.
    let call = 0;
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        advert_bookings: () => queryBuilder(() =>
          call++ === 0
            ? dbOk({ id: "b1", status: "awaiting_approval", advert: { member_id: "m1" }, price_pennies: null })
            : { data: null, error: { message: "advert_bookings_no_overlap" } },
        ),
        approvals: () => approvalsBuilder,
      }, () => queryBuilder(dbOk(null))),
    })));

    await expect(decideAdvertBooking(form({ id: "b1", decision: "approve" })))
      .rejects.toThrow(/That%20advert%20already%20has%20a%20run/);
    expect(approvalsBuilder.insert).not.toHaveBeenCalled();
  });
});

describe("renewBooking", () => {
  it("does nothing for a booking that no longer exists", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk(null)) });
    await expect(renewBooking(form({ id: "b1" }))).resolves.toBeUndefined();
  });

  it("carries forward the artwork/price/bundle but takes fresh dates, landing as a draft", async () => {
    type Prev = { advert_id: string; price_pennies: number; bundle_id: string | null; notes: string };
    type Created = { id: string };
    const bookingsBuilder: ReturnType<typeof queryBuilder<Prev | Created>> = queryBuilder<Prev | Created>(() => {
      const inserts = (bookingsBuilder.insert as ReturnType<typeof vi.fn>).mock.calls;
      return inserts.length
        ? dbOk<Created>({ id: "b2" })
        : dbOk<Prev>({ advert_id: "ad1", price_pennies: 65000, bundle_id: null, notes: "old notes" });
    });
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewBooking(form({ id: "b1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2");

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      advert_id: "ad1", price_pennies: 65000, status: "draft", renewed_from: "b1",
    }));
  });

  // 16 Oct: the bundle is invoiced once, as a whole — a part carrying its own
  // price into a renewal would bill it twice.
  it("doesn't carry a bundle part's own price into its renewal", async () => {
    type Prev = { advert_id: string; price_pennies: number; bundle_id: string | null; notes: string | null };
    type Created = { id: string };
    let inserted = false;
    const bookingsBuilder = queryBuilder<Prev | Created>(() => (inserted
      ? dbOk<Created>({ id: "b2" })
      : dbOk<Prev>({ advert_id: "ad1", price_pennies: 65000, bundle_id: "bun1", notes: null })));
    (bookingsBuilder.insert as ReturnType<typeof vi.fn>).mockImplementation(() => { inserted = true; return bookingsBuilder; });
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewBooking(form({ id: "b1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2");

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ bundle_id: "bun1", price_pennies: null }));
  });
});

// Review finding: renewBooking's draft had no way on — the booking page offered
// nothing for a draft, so a console rebook never reached the site.
describe("bookDraftRun", () => {
  const draft = (over: Record<string, unknown> = {}) => ({
    id: "b2", status: "draft", source: "admin", starts_on: "2026-11-01", ends_on: "2026-11-30", bundle_id: null,
    advert: { member_id: "m1", name: "Acme banner" }, ...over,
  });
  /**
   * advert_bookings, a fresh builder per query: the draft on a read (and one
   * billable part, for billItem's count), `updated` on the conditional update.
   * `update` is the one write the action makes, for asserting on.
   */
  const bookings = (row: Record<string, unknown> | null, updated: { id: string }[] = [{ id: "b2" }]) => {
    const builders: Builder[] = [];
    const factory = () => {
      const b: Builder = queryBuilder((): DbResult => (calls(b, "update").length ? dbOk(updated) : dbOk(row, 1)));
      builders.push(b);
      return b;
    };
    const writes = () => builders.flatMap((b) => calls(b, "update").map((c) => c[0]));
    const updatedWhere = (...args: unknown[]) => builders.some((b) => calls(b, "update").length && called(b, "eq", ...args));
    return { factory, writes, updatedWhere };
  };

  it("books a priced renewal: held for payment, invoiced off the price confirmed, with the pay link", async () => {
    const bookingsTable = bookings(draft());
    const invoices = invoicesTable();
    db({ advert_bookings: bookingsTable.factory, invoices: invoices.factory });

    await expect(bookDraftRun(form({ id: "b2", price_pounds: "650" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2?saved=1");

    expect(bookingsTable.writes()).toEqual([expect.objectContaining({
      status: "awaiting_payment", price_pennies: 65000, approved_by: "admin1",
    })]);
    expect(bookingsTable.updatedWhere("status", "draft")).toBe(true);
    expect(invoices.inserts()).toEqual([expect.objectContaining({ member_id: "m1", amount_pennies: 65000, advert_booking_id: "b2" })]);
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due", booking_id: "b2" }));
  });

  it("books an unpriced renewal straight to scheduled, invoicing nothing", async () => {
    const bookingsTable = bookings(draft());
    const invoices = invoicesTable();
    db({ advert_bookings: bookingsTable.factory, invoices: invoices.factory });

    await expect(bookDraftRun(form({ id: "b2", price_pounds: "" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2?saved=1");

    expect(bookingsTable.writes()).toEqual([expect.objectContaining({ status: "scheduled", price_pennies: null })]);
    expect(invoices.inserts()).toEqual([]);
  });

  it.each([
    ["a member's own draft", draft({ source: "member" })],
    ["a run that is already booked", draft({ status: "scheduled" })],
    ["a booking that no longer exists", null],
  ])("leaves %s alone", async (_, row) => {
    const bookingsTable = bookings(row);
    db({ advert_bookings: bookingsTable.factory });

    await expect(bookDraftRun(form({ id: "b2", price_pounds: "650" }))).resolves.toBeUndefined();
    expect(bookingsTable.writes()).toEqual([]);
  });

  it("a double click books it once: the second finds no draft left, and invoices nothing", async () => {
    const invoices = invoicesTable();
    db({ advert_bookings: bookings(draft(), []).factory, invoices: invoices.factory });

    await expect(bookDraftRun(form({ id: "b2", price_pounds: "650" }))).resolves.toBeUndefined();
    expect(invoices.inserts()).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a price that isn't one, before writing anything", async () => {
    const bookingsTable = bookings(draft());
    db({ advert_bookings: bookingsTable.factory });

    await expect(bookDraftRun(form({ id: "b2", price_pounds: "1e5" }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/b2\?error=/);
    expect(bookingsTable.writes()).toEqual([]);
  });

  // A draft reserves no dates, so booking it is where the overlap can strike.
  it("says so when the artwork has been booked for those dates since", async () => {
    const b: Builder = queryBuilder((): DbResult => (calls(b, "update").length
      ? dbError('conflicting key value violates exclusion constraint "advert_bookings_no_overlap"')
      : dbOk(draft())));
    db({ advert_bookings: () => b });

    await expect(bookDraftRun(form({ id: "b2", price_pounds: "650" }))).rejects.toThrow(/That%20advert%20already%20has%20a%20run%20covering%20those%20dates/);
  });

  describe("a bundle part", () => {
    const bundle = () => queryBuilder(dbOk({ id: "bd1", member_id: "m1", name: "Spring set", price_pennies: 20000 }));

    it("takes no price of its own — the bundle's one invoice bills it, and it is held until that is paid", async () => {
      const bookingsTable = bookings(draft({ bundle_id: "bd1" }));
      const invoices = invoicesTable();
      db({ advert_bookings: bookingsTable.factory, bundles: bundle, invoices: invoices.factory });

      // a price posted anyway is ignored: it would bill the part twice
      await expect(bookDraftRun(form({ id: "b2", price_pounds: "650" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2?saved=1");

      expect(bookingsTable.writes()).toEqual([
        expect.objectContaining({ status: "awaiting_payment", price_pennies: null }),
        // the bundle's invoice is raised now, so its other parts still to
        // start join the hold — billItem, as for saveBundleBooking
        { status: "awaiting_payment", updated_at: expect.any(String) },
      ]);
      expect(invoices.inserts()).toEqual([expect.objectContaining({ amount_pennies: 20000, bundle_id: "bd1", advert_booking_id: null })]);
    });

    it("of a paid bundle runs on that payment — scheduled, not billed again", async () => {
      const bookingsTable = bookings(draft({ bundle_id: "bd1" }));
      const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 20000, status: "paid" });
      db({ advert_bookings: bookingsTable.factory, bundles: bundle, invoices: invoices.factory });

      await expect(bookDraftRun(form({ id: "b2" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2?saved=1");

      expect(bookingsTable.writes()).toEqual([expect.objectContaining({ status: "scheduled", price_pennies: null })]);
      expect(invoices.inserts()).toEqual([]);
    });
  });
});

describe("markInvoicePaid", () => {
  const INV = "11111111-1111-4111-8111-111111111111";

  // Settlement — paid, the run released, the receipt queued — is one
  // transaction in settle_invoice() (20261016000003), so it's stubbed at the rpc.
  it("settles through the same seam as a card payment", async () => {
    const rpc = vi.fn(async () => dbOk({ outcome: "settled", member_id: "m1", job_id: "j1" }));
    db({}, rpc);

    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/console/adverts/b1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b1?saved=1");

    expect(rpc).toHaveBeenCalledWith("settle_invoice", { p_invoice_id: INV });
  });

  it("a database failure is said on the page, not thrown to the error boundary", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({}, async () => dbError("connection reset"));
    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/console/adverts/b1" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/b1\?error=The%20payment%20couldn't%20be%20recorded/);
  });

  it("a cancelled invoice says it was cancelled, not just 'paid or void'", async () => {
    db({}, async () => dbOk({ outcome: "void", member_id: "m1" }));
    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/console/adverts/b1" })))
      .rejects.toThrow(/error=That%20invoice%20was%20cancelled/);
  });

  it("needs the confirmation tick", async () => {
    const from = db({});
    await expect(markInvoicePaid(form({ invoice_id: INV, return_to: "/console/adverts/b1" }))).rejects.toThrow(/error=Tick/);
    expect(from).not.toHaveBeenCalled();
  });

  it("says so when the invoice was already paid", async () => {
    db({}, async () => dbOk({ outcome: "paid", member_id: "m1", paid_session_id: null }));
    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/console/adverts/b1" })))
      .rejects.toThrow(/error=That%20invoice%20is%20already%20paid/);
  });

  it("only ever returns to a console page", async () => {
    db({}, async () => dbOk({ outcome: "paid" }));
    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/dashboard/evil" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?error=/);
  });
});

// GAPS A2.12: a desk rebook draft's dates can change, and an unwanted one can go.
// Only while it's still the desk's draft — the member may have submitted it.
describe("updateDraftDates / deleteDraftBooking", () => {
  const table = (result: DbResult) => {
    const b = queryBuilder(result);
    db({ advert_bookings: () => b });
    return b;
  };

  it("changes the dates of the desk's own draft only", async () => {
    const b = table(dbOk([{ id: "b2" }]));
    await expect(updateDraftDates(form({ id: "b2", starts_on: "2099-03-01", ends_on: "2099-03-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2?saved=1");
    expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ starts_on: "2099-03-01", ends_on: "2099-03-31" }));
    expect(called(b, "eq", "status", "draft")).toBe(true);
    expect(called(b, "eq", "source", "admin")).toBe(true);
  });

  it("refuses dates out of order or in the past, writing nothing", async () => {
    for (const [starts_on, ends_on, says] of [
      ["2099-03-31", "2099-03-01", "end on or after"],
      ["2001-01-01", "2001-01-31", "start in the past"],
      ["2099-02-30", "2099-03-01", "Choose a start and an end"],
    ]) {
      const b = table(dbOk([{ id: "b2" }]));
      await expect(updateDraftDates(form({ id: "b2", starts_on, ends_on }))).rejects.toThrow(encodeURIComponent(says));
      expect(b.update).not.toHaveBeenCalled();
    }
  });

  it("says so when the draft has moved on (booked, or sent in by the member)", async () => {
    table(dbOk([]));
    await expect(updateDraftDates(form({ id: "b2", starts_on: "2099-03-01", ends_on: "2099-03-31" })))
      .rejects.toThrow(encodeURIComponent("This draft has moved on"));
  });

  it("deletes the desk's draft only with the confirm ticked", async () => {
    const unconfirmed = table(dbOk([{ id: "b2" }]));
    await expect(deleteDraftBooking(form({ id: "b2" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2?error=");
    expect(unconfirmed.delete).not.toHaveBeenCalled();

    const b = table(dbOk([{ id: "b2" }]));
    await expect(deleteDraftBooking(form({ id: "b2", confirm: "1" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts?deleted=1");
    expect(b.delete).toHaveBeenCalled();
    expect(called(b, "eq", "status", "draft")).toBe(true);
    expect(called(b, "eq", "source", "admin")).toBe(true);
  });

  it("deletes nothing that has moved on, and says so", async () => {
    table(dbOk([]));
    await expect(deleteDraftBooking(form({ id: "b2", confirm: "1" })))
      .rejects.toThrow(encodeURIComponent("This draft has moved on"));
  });
});
