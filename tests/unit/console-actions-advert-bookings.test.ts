import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAdvertBooking, endBooking, markInvoicePaid, renewBooking, saveBooking, saveBundle, saveBundleBooking } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

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

function db(map: Record<string, () => ReturnType<typeof queryBuilder>>) {
  const from = fromByTable(map, () => queryBuilder(dbOk(null)));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("saveBooking", () => {
  // fix-list 77: the price is on the booking — there is no rate card to read.
  it("records the price on the run and invoices off it", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert: { member_id: "m1" } }));
    const invoicesBuilder = queryBuilder(dbOk(null));
    const from = db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder });

    // Succeeds by redirecting with ?saved=1 now — a booking that worked used to
    // be pixel-identical to one that was rejected (fix-list 73's convention).
    await expect(saveBooking(form({ advert_id: "ad1", price_pounds: "650.50", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?saved=1/);

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 65050, status: "awaiting_payment" }));
    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.not.objectContaining({ product_id: expect.anything() }));
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ member_id: "m1", amount_pennies: 65050 }));
    expect(from).not.toHaveBeenCalledWith("advert_products");
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
    type Lookup = { id: string; ends_on: string; advert: { member_id: string } };
    type Claim = { id: string }[];
    const bookingsBuilder: ReturnType<typeof queryBuilder<Lookup | Claim>> = queryBuilder<Lookup | Claim>(() => {
      const updates = (bookingsBuilder.update as ReturnType<typeof vi.fn>).mock.calls;
      return updates.length
        ? dbOk<Claim>([{ id: "b1" }])
        : dbOk<Lookup>({ id: "b1", ends_on: "2026-09-30", advert: { member_id: "m1" } });
    });
    db({ advert_bookings: () => bookingsBuilder });

    await endBooking(form({ id: "b1", note: "Client requested early end" }));

    const [payload] = (bookingsBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({ status: "ended", ended_reason: "ended_early", ended_note: "Client requested early end" });
    expect(payload).not.toHaveProperty("ends_on");
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_ended" }));
  });

  it("can call off a run held for payment, voiding its own unpaid invoice", async () => {
    type Lookup = { id: string; ends_on: string; advert: { member_id: string } };
    type Claim = { id: string }[];
    const bookingsBuilder: ReturnType<typeof queryBuilder<Lookup | Claim>> = queryBuilder<Lookup | Claim>(() => {
      const updates = (bookingsBuilder.update as ReturnType<typeof vi.fn>).mock.calls;
      return updates.length ? dbOk<Claim>([{ id: "b1" }]) : dbOk<Lookup>({ id: "b1", ends_on: "2026-12-31", advert: { member_id: "m1" } });
    });
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder });

    await endBooking(form({ id: "b1" }));

    expect(bookingsBuilder.in).toHaveBeenCalledWith("status", ["awaiting_payment", "scheduled", "live"]);
    expect(invoicesBuilder.update).toHaveBeenCalledWith({ status: "void" });
    expect(invoicesBuilder.eq).toHaveBeenCalledWith("advert_booking_id", "b1");
    expect(invoicesBuilder.eq).toHaveBeenCalledWith("status", "issued");
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
    const builder = queryBuilder(dbOk(null));
    db({ bundles: () => builder });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "150" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/bundles/bd1?saved=1");

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 15000 }));
  });

  it("reports a failed update instead of claiming it saved", async () => {
    db({ bundles: () => queryBuilder(dbError("boom")) });
    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/bundles/bd1?error=boom");
  });

  it("creates a new bundle and redirects to it", async () => {
    const builder = queryBuilder(dbOk({ id: "bd1" }));
    db({ bundles: () => builder });

    await expect(saveBundle(form({ member_id: "m1", name: "Spring set" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/bundles/bd1");
  });
});

describe("saveBundleBooking", () => {
  it("requires at least one piece of artwork", async () => {
    await expect(saveBundleBooking(form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/Pick%20at%20least%20one%20piece%20of%20artwork/);
  });

  it("invoices once for the whole bundle on its first booking, not on later add-ons", async () => {
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({
      bundles: () => queryBuilder(dbOk({ member_id: "m1", price_pennies: 20000 })),
      advert_bookings: () => queryBuilder(dbOk(null, 0)),
      invoices: () => invoicesBuilder,
    });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad1");
    fd.append("advert_ids", "ad2");
    await saveBundleBooking(fd);

    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ member_id: "m1", amount_pennies: 20000 }));
  });

  it("does not invoice again when parts already exist on the bundle", async () => {
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({
      bundles: () => queryBuilder(dbOk({ member_id: "m1", price_pennies: 20000 })),
      advert_bookings: () => queryBuilder(dbOk(null, 2)),
      invoices: () => invoicesBuilder,
    });

    const fd = form({ bundle_id: "bd1", starts_on: "2026-09-01", ends_on: "2026-09-30" });
    fd.append("advert_ids", "ad3");
    await saveBundleBooking(fd);

    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
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
  it("approving a priced run holds it for payment, invoices it, and sends the pay link", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", starts_on: "2026-11-01", ends_on: "2026-11-30", price_pennies: 3000, advert: { member_id: "m1", name: "Autumn banner" } }));
    const invoicesBuilder = queryBuilder(dbOk({ id: "inv1" }));
    db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_payment", price_pennies: 3000, approved_at: expect.any(String) }));
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      amount_pennies: 3000, advert_booking_id: "b1", description: "Advert: Autumn banner (2026-11-01 to 2026-11-30)",
    }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due", invoice_id: "inv1", amount: "£30.00", booking_id: "b1" }));
    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
  });

  it("approving an unpriced run schedules it straight away", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", starts_on: "2026-11-01", ends_on: "2026-11-30", price_pennies: null, advert: { member_id: "m1", name: "Autumn banner" } }));
    db({ advert_bookings: () => bookingsBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
  });

  it("with payments off in production, a priced run schedules as before and Jas invoices by hand", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", starts_on: "2026-11-01", ends_on: "2026-11-30", price_pennies: 3000, advert: { member_id: "m1", name: "Autumn banner" } }));
    const invoicesBuilder = queryBuilder(dbOk({ id: "inv1" }));
    db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(invoicesBuilder.insert).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
    expect(enqueue).not.toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due" }));
  });

  it("prices a member's unpriced request from the approve form, and invoices that", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", price_pennies: null, advert: { member_id: "m1" } }));
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve", price_pounds: "420" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 42000 }));
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ amount_pennies: 42000 }));
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
});

describe("markInvoicePaid", () => {
  const INV = "11111111-1111-4111-8111-111111111111";

  it("settles through the same seam as a card payment, releasing the run", async () => {
    const invoices = queryBuilder(dbOk([{ id: INV, member_id: "m1", number: "SMI-ADV-1", amount_pennies: 3000, advert_booking_id: "b1", bundle_id: null, placement_id: null }]));
    const bookings = queryBuilder(dbOk(null));
    db({ invoices: () => invoices, advert_bookings: () => bookings });

    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/console/adverts/b1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b1?saved=1");

    expect(invoices.update).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }));
    expect(bookings.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_received" }));
  });

  it("needs the confirmation tick", async () => {
    const from = db({});
    await expect(markInvoicePaid(form({ invoice_id: INV, return_to: "/console/adverts/b1" }))).rejects.toThrow(/error=Tick/);
    expect(from).not.toHaveBeenCalled();
  });

  it("says so when the invoice was already paid", async () => {
    db({ invoices: () => queryBuilder(dbOk([])) });
    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/console/adverts/b1" })))
      .rejects.toThrow(/already%20paid%20or%20void/);
  });

  it("only ever returns to a console page", async () => {
    db({ invoices: () => queryBuilder(dbOk([])) });
    await expect(markInvoicePaid(form({ invoice_id: INV, confirm: "1", return_to: "/dashboard/evil" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?error=/);
  });
});
