import { afterEach, describe, expect, it, vi } from "vitest";
import { decideAdvertBooking, endBooking, renewBooking, saveBooking, saveBundle, saveBundleBooking } from "@/app/console/actions";
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
  it("raises an invoice off the product's rate when one was sold", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert: { member_id: "m1" } }));
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({
      advert_bookings: () => bookingsBuilder,
      advert_products: () => queryBuilder(dbOk({ rate_pennies: 5000 })),
      invoices: () => invoicesBuilder,
    });

    await saveBooking(form({ advert_id: "ad1", product_id: "p1", starts_on: "2026-09-01", ends_on: "2026-09-30" }));

    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ member_id: "m1", amount_pennies: 5000 }));
  });

  it("skips invoicing for an unpriced product", async () => {
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({
      advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert: { member_id: "m1" } })),
      advert_products: () => queryBuilder(dbOk({ rate_pennies: null })),
      invoices: () => invoicesBuilder,
    });

    await saveBooking(form({ advert_id: "ad1", product_id: "p1", starts_on: "2026-09-01", ends_on: "2026-09-30" }));

    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
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

  it("is idempotent — does not re-notify when a double submit finds nothing left to end", async () => {
    db({ advert_bookings: () => queryBuilder(() => {
      return dbOk(null); // both the lookup and the conditional update return nothing
    }) });

    await endBooking(form({ id: "b1" }));

    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("saveBundle", () => {
  it("does nothing without a member and a name", async () => {
    const from = db({});
    await saveBundle(form({ member_id: "", name: "Spring set" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("updates an existing bundle in place without redirecting", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ bundles: () => builder });

    await expect(saveBundle(form({ id: "bd1", member_id: "m1", name: "Spring set", price_pounds: "150" }))).resolves.toBeUndefined();

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 15000 }));
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
    db({ advert_bookings: () => queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", advert: { member_id: "m1" }, product: null })) });

    await expect(decideAdvertBooking(form({ id: "b1", decision: "reject" })))
      .rejects.toThrow(/Give%20the%20member%20a%20reason/);
  });

  it("approving schedules the run, invoices off the product, and notifies the member", async () => {
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", status: "awaiting_approval", advert: { member_id: "m1" }, product: { rate_pennies: 3000 } }));
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({ advert_bookings: () => bookingsBuilder, invoices: () => invoicesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideAdvertBooking(form({ id: "b1", decision: "approve" }));

    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "scheduled" }));
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ amount_pennies: 3000 }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_scheduled" }));
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
            ? dbOk({ id: "b1", status: "awaiting_approval", advert: { member_id: "m1" }, product: null })
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

  it("carries forward the artwork/product/bundle but takes fresh dates, landing as a draft", async () => {
    type Prev = { advert_id: string; product_id: string; bundle_id: string | null; notes: string };
    type Created = { id: string };
    const bookingsBuilder: ReturnType<typeof queryBuilder<Prev | Created>> = queryBuilder<Prev | Created>(() => {
      const inserts = (bookingsBuilder.insert as ReturnType<typeof vi.fn>).mock.calls;
      return inserts.length
        ? dbOk<Created>({ id: "b2" })
        : dbOk<Prev>({ advert_id: "ad1", product_id: "p1", bundle_id: null, notes: "old notes" });
    });
    db({ advert_bookings: () => bookingsBuilder });

    await expect(renewBooking(form({ id: "b1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b2");

    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      advert_id: "ad1", product_id: "p1", status: "draft", renewed_from: "b1",
    }));
  });
});
