import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBannerRun, saveSupplierLogo } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { invoicesTable } from "../stubs/invoices-table";
import type { CurrentUser } from "@/lib/auth";

// logError is the seam these failure paths report through (docs/logging.md);
// mocked so a test never writes to the real error log.
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));
afterEach(() => logError.mockReset());

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, removeMedia } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  removeMedia: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, uploadDocument: vi.fn(async () => null), removeMedia }));
vi.mock("@/lib/jobs", () => ({ enqueue: vi.fn(async () => {}) }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
  removeMedia.mockReset().mockResolvedValue(undefined);
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

const RUN = { starts_on: "2026-11-01", ends_on: "2026-11-30" };

/** The form with real (non-empty) files in the named inputs — a new run is refused before upload without them. */
function withFiles(fd: FormData, ...fields: string[]) {
  for (const f of fields) fd.set(f, new File(["img"], `${f}.png`, { type: "image/png" }));
  return fd;
}

describe("saveSupplierLogo — new", () => {
  it("makes the advert and an approved run in one step, and invoices the price", async () => {
    uploadImage.mockResolvedValue("panels/logo.png");
    const advertsBuilder = queryBuilder(dbOk({ id: "ad9" }));
    const bookingsBuilder = queryBuilder(dbOk({ id: "b9" }));
    const invoicesBuilder = queryBuilder(dbOk({ id: "inv9" }));
    db({
      members: () => queryBuilder(dbOk({ name: "Acme Steel" })),
      adverts: () => advertsBuilder,
      advert_bookings: () => bookingsBuilder,
      invoices: () => invoicesBuilder,
    });

    await expect(saveSupplierLogo(withFiles(form({ member_id: "m1", price_pounds: "100", link_url: "https://acme.example", ...RUN }), "logo")))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/suppliers?saved=1");

    expect(uploadImage).toHaveBeenCalledWith(expect.any(File), "panels");
    expect(advertsBuilder.insert).toHaveBeenCalledWith({
      member_id: "m1", name: "Acme Steel supplier logo", format: "supplier_logo",
      desktop_path: "panels/logo.png", mobile_path: "panels/logo.png", link_url: "https://acme.example",
    });
    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      // priced → held until the member pays (6 Oct)
      advert_id: "ad9", status: "awaiting_payment", source: "admin", approved_by: "admin1", price_pennies: 10000, ...RUN,
    }));
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ member_id: "m1", amount_pennies: 10000, advert_booking_id: "b9" }));
  });

  it("requires the logo", async () => {
    const from = db({});
    await expect(saveSupplierLogo(form({ member_id: "m1", ...RUN })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/suppliers\?error=Upload%20the%20logo/);
    expect(from).not.toHaveBeenCalled();
  });

  it("requires a member and both dates", async () => {
    await expect(saveSupplierLogo(form({ ...RUN }))).rejects.toThrow(/Pick%20the%20member/);
    await expect(saveSupplierLogo(form({ member_id: "m1", starts_on: "2026-11-01" }))).rejects.toThrow(/start%20and%20an%20end%20date/);
  });

  it("removes the just-made advert and its image when the run can't be booked", async () => {
    uploadImage.mockResolvedValue("panels/logo.png");
    const advertsBuilder = queryBuilder(dbOk({ id: "ad9" }));
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({
      members: () => queryBuilder(dbOk({ name: "Acme Steel" })),
      adverts: () => advertsBuilder,
      advert_bookings: () => queryBuilder(dbError('violates exclusion constraint "advert_bookings_no_overlap"')),
      invoices: () => invoicesBuilder,
    });

    await expect(saveSupplierLogo(withFiles(form({ member_id: "m1", price_pounds: "100", ...RUN }), "logo")))
      .rejects.toThrow(/That%20logo%20already%20has%20a%20run/);

    expect(advertsBuilder.delete).toHaveBeenCalled();
    expect(advertsBuilder.eq).toHaveBeenCalledWith("id", "ad9");
    expect(removeMedia).toHaveBeenCalledWith("panels/logo.png");
    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
  });
});

describe("saveSupplierLogo — edit", () => {
  it("updates dates, price and link, keeping the logo when none is uploaded", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    // an unpriced run gaining no price: nothing to bill
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert_id: "ad9", bundle_id: null, price_pennies: null, status: "live", advert: { format: "supplier_logo", member_id: "m1" } }));
    const invoices = invoicesTable();
    db({ adverts: () => advertsBuilder, advert_bookings: () => bookingsBuilder, invoices: invoices.factory });

    await expect(saveSupplierLogo(form({ id: "b1", price_pounds: "", link_url: "", ...RUN })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/suppliers/b1?saved=1");

    const [advertPatch] = (advertsBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(advertPatch).toMatchObject({ link_url: null });
    expect(advertPatch).not.toHaveProperty("desktop_path");
    expect(advertsBuilder.eq).toHaveBeenCalledWith("id", "ad9");
    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: null, ...RUN }));
    expect(invoices.inserts()).toEqual([]);
  });
  it("refuses to edit a booking that isn't a supplier logo", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    db({
      adverts: () => advertsBuilder,
      advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert_id: "ad9", advert: { format: "banner" } })),
    });

    await expect(saveSupplierLogo(form({ id: "b1", ...RUN })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/suppliers\?error=That%20supplier%20logo%20booking%20no%20longer%20exists/);
    expect(advertsBuilder.update).not.toHaveBeenCalled();
  });
});

// Banners book through the same action shape, with their two real sizes.
describe("saveBannerRun", () => {
  it("needs both images for a new banner, and refuses before uploading the one that was chosen", async () => {
    const from = db({});
    await expect(saveBannerRun(withFiles(form({ member_id: "m1", ...RUN }), "desktop")))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/banners\?error=Upload%20both%20the%20desktop%20and%20the%20mobile%20image/);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("books a banner advert with its two sizes, held when priced", async () => {
    let n = 0;
    uploadImage.mockImplementation(async () => (++n === 1 ? "panels/d.png" : "panels/m.png"));
    const advertsBuilder = queryBuilder(dbOk({ id: "ad7" }));
    const bookingsBuilder = queryBuilder(dbOk({ id: "b7" }));
    db({
      members: () => queryBuilder(dbOk({ name: "Acme Steel" })),
      adverts: () => advertsBuilder,
      advert_bookings: () => bookingsBuilder,
      invoices: () => queryBuilder(dbOk({ id: "inv7" })),
    });

    await expect(saveBannerRun(withFiles(form({ member_id: "m1", price_pounds: "650", ...RUN }), "desktop", "mobile")))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/banners?saved=1");

    expect(advertsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      name: "Acme Steel banner", format: "banner", desktop_path: "panels/d.png", mobile_path: "panels/m.png",
    }));
    expect(bookingsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ advert_id: "ad7", status: "awaiting_payment", price_pennies: 65000 }));
  });

  it("edits a retired narrow banner too, but not a supplier logo", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => advertsBuilder, advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert_id: "ad1", advert: { format: "banner_narrow" } })) });
    await expect(saveBannerRun(form({ id: "b1", ...RUN }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/banners/b1?saved=1");

    db({ adverts: () => advertsBuilder, advert_bookings: () => queryBuilder(dbOk({ id: "b2", advert_id: "ad2", advert: { format: "supplier_logo" } })) });
    await expect(saveBannerRun(form({ id: "b2", ...RUN }))).rejects.toThrow(/That%20banner%20booking%20no%20longer%20exists/);
  });
});

// Review findings 16 Oct: validate before uploading, clean up after a failure,
// and never put new artwork live on a save that's refused.
describe("saveArtworkRun — order and clean-up", () => {
  it("an edit whose dates are refused leaves the artwork and link untouched, and drops the new image", async () => {
    uploadImage.mockResolvedValue("panels/new.png");
    const advertsBuilder = queryBuilder(dbOk(null));
    let call = 0;
    db({
      adverts: () => advertsBuilder,
      advert_bookings: () => queryBuilder(++call === 1
        ? dbOk({ id: "b1", advert_id: "ad9", advert: { format: "supplier_logo" } })
        : dbError('conflicting key value violates exclusion constraint "advert_bookings_no_overlap"')),
    });

    await expect(saveSupplierLogo(withFiles(form({ id: "b1", link_url: "https://new.example", ...RUN }), "logo")))
      .rejects.toThrow(/suppliers\/b1\?error=That%20logo%20already%20has%20a%20run/);
    expect(advertsBuilder.update).not.toHaveBeenCalled();
    expect(removeMedia).toHaveBeenCalledWith("panels/new.png");
  });

  it("an edit of a booking that's gone uploads nothing", async () => {
    db({ advert_bookings: () => queryBuilder(dbOk(null)) });
    await expect(saveSupplierLogo(withFiles(form({ id: "b1", ...RUN }), "logo"))).rejects.toThrow(/no%20longer%20exists/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("a new run for a member that's gone uploads nothing", async () => {
    db({ members: () => queryBuilder(dbOk(null)) });
    await expect(saveSupplierLogo(withFiles(form({ member_id: "m1", ...RUN }), "logo"))).rejects.toThrow(/That%20member%20no%20longer%20exists/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("drops the uploaded image when the advert itself can't be created", async () => {
    uploadImage.mockResolvedValue("panels/logo.png");
    db({ members: () => queryBuilder(dbOk({ name: "Acme" })), adverts: () => queryBuilder(dbError("boom")) });
    await expect(saveSupplierLogo(withFiles(form({ member_id: "m1", ...RUN }), "logo"))).rejects.toThrow(/error=That%20couldn't%20be%20saved/);
    expect(removeMedia).toHaveBeenCalledWith("panels/logo.png");
  });
});

describe("saveArtworkRun — the click-through link", () => {
  it("refuses anything but an http(s) web address, before uploading", async () => {
    const from = db({});
    for (const link_url of ["javascript:alert(1)", "data:text/html,hi", "ftp://acme.example", "not a link"]) {
      await expect(saveSupplierLogo(withFiles(form({ member_id: "m1", link_url, ...RUN }), "logo")))
        .rejects.toThrow(/suppliers\?error=The%20click-through%20link%20must%20be%20a%20web%20address/);
    }
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("stores a bare www. address as https", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => advertsBuilder, advert_bookings: () => queryBuilder(dbOk({ id: "b1", advert_id: "ad9", advert: { format: "supplier_logo" } })) });
    await expect(saveSupplierLogo(form({ id: "b1", link_url: "www.acme.co.uk", ...RUN }))).rejects.toThrow(/saved=1/);
    expect(advertsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ link_url: "https://www.acme.co.uk" }));
  });
});

// Review finding 16 Oct (user decision: build it): an edit only recorded the
// price — a price added later was never billed, and a changed one left the old
// invoice payable at the old amount.
describe("saveArtworkRun — the run's invoice follows its price", () => {
  const run = (extra: Record<string, unknown>) => queryBuilder(dbOk({
    id: "b1", advert_id: "ad9", bundle_id: null, starts_on: "2099-11-01", ends_on: "2099-11-30",
    advert: { format: "supplier_logo", member_id: "m1", name: "Acme logo" }, ...extra,
  }));
  const FUTURE = { starts_on: "2099-11-01", ends_on: "2099-11-30" };

  it("a price added to a run that hasn't started raises the invoice and holds the run", async () => {
    const bookings = run({ status: "scheduled", price_pennies: 12000 });
    const invoices = invoicesTable();
    db({ adverts: () => queryBuilder(dbOk(null)), advert_bookings: () => bookings, invoices: invoices.factory });

    await expect(saveSupplierLogo(form({ id: "b1", price_pounds: "120", ...FUTURE }))).rejects.toThrow(/b1\?saved=1/);

    expect(invoices.inserts()).toEqual([expect.objectContaining({ advert_booking_id: "b1", amount_pennies: 12000, member_id: "m1" })]);
    expect(bookings.update).toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_payment" }));
  });

  it("a price added to a run already live is invoiced, but the run stays on the site", async () => {
    const bookings = run({ status: "live", price_pennies: 12000, starts_on: "2020-01-01" });
    const invoices = invoicesTable();
    db({ adverts: () => queryBuilder(dbOk(null)), advert_bookings: () => bookings, invoices: invoices.factory });

    await expect(saveSupplierLogo(form({ id: "b1", price_pounds: "120", ...RUN }))).rejects.toThrow(/b1\?saved=1/);

    expect(invoices.inserts()).toHaveLength(1);
    expect(bookings.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: "awaiting_payment" }));
  });

  it("a new price on an unpaid invoice voids the old one and raises one at the new price", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 10000, status: "issued" });
    db({ adverts: () => queryBuilder(dbOk(null)), advert_bookings: () => run({ status: "awaiting_payment", price_pennies: 12000 }), invoices: invoices.factory });

    await expect(saveSupplierLogo(form({ id: "b1", price_pounds: "120", ...FUTURE }))).rejects.toThrow(/b1\?saved=1/);

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(invoices.inserts()).toEqual([expect.objectContaining({ amount_pennies: 12000 })]);
  });

  it("the same price with its invoice on record raises nothing", async () => {
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 12000, status: "issued" });
    db({ adverts: () => queryBuilder(dbOk(null)), advert_bookings: () => run({ status: "awaiting_payment", price_pennies: 12000 }), invoices: invoices.factory });

    await expect(saveSupplierLogo(form({ id: "b1", price_pounds: "120", ...FUTURE }))).rejects.toThrow(/b1\?saved=1/);

    expect(invoices.inserts()).toEqual([]);
    expect(invoices.updates()).toEqual([]);
  });

  it("a failed invoice on a new run is said on the run's own page", async () => {
    uploadImage.mockResolvedValue("panels/logo.png");
    db({
      members: () => queryBuilder(dbOk({ name: "Acme Steel" })),
      adverts: () => queryBuilder(dbOk({ id: "ad9" })),
      advert_bookings: () => queryBuilder(dbOk({ id: "b9" })),
      invoices: () => queryBuilder(dbError("boom")),
    });
    await expect(saveSupplierLogo(withFiles(form({ member_id: "m1", price_pounds: "100", ...RUN }), "logo")))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/suppliers\/b9\?error=Saved%2C%20but%20the%20invoice/);
  });
});
