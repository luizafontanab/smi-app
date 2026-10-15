import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBannerRun, saveSupplierLogo } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

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

    await expect(saveSupplierLogo(form({ member_id: "m1", price_pounds: "100", link_url: "https://acme.example", ...RUN })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/suppliers?saved=1");

    expect(uploadImage).toHaveBeenCalledWith(null, "panels");
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

    await expect(saveSupplierLogo(form({ member_id: "m1", price_pounds: "100", ...RUN })))
      .rejects.toThrow(/That%20logo%20already%20has%20a%20run/);

    expect(advertsBuilder.delete).toHaveBeenCalled();
    expect(advertsBuilder.eq).toHaveBeenCalledWith("id", "ad9");
    expect(removeMedia).toHaveBeenCalledWith("panels/logo.png");
    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
  });
});

describe("saveSupplierLogo — edit", () => {
  it("updates dates, price and link, keeping the logo when none is uploaded, and raises no invoice", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    const bookingsBuilder = queryBuilder(dbOk({ id: "b1", advert_id: "ad9", advert: { format: "supplier_logo" } }));
    const from = db({ adverts: () => advertsBuilder, advert_bookings: () => bookingsBuilder });

    await expect(saveSupplierLogo(form({ id: "b1", price_pounds: "120", link_url: "", ...RUN })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/suppliers/b1?saved=1");

    const [advertPatch] = (advertsBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(advertPatch).toMatchObject({ link_url: null });
    expect(advertPatch).not.toHaveProperty("desktop_path");
    expect(advertsBuilder.eq).toHaveBeenCalledWith("id", "ad9");
    expect(bookingsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ price_pennies: 12000, ...RUN }));
    expect(from).not.toHaveBeenCalledWith("invoices");
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
  it("needs both images for a new banner, and cleans up the one that did upload", async () => {
    uploadImage.mockImplementation(async (_file, prefix) => (prefix === "panels" && uploadImage.mock.calls.length === 1 ? "panels/desktop.png" : null));
    const from = db({});
    await expect(saveBannerRun(form({ member_id: "m1", ...RUN })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/banners\?error=Upload%20both%20the%20desktop%20and%20the%20mobile%20image/);
    expect(removeMedia).toHaveBeenCalledWith("panels/desktop.png");
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

    await expect(saveBannerRun(form({ member_id: "m1", price_pounds: "650", ...RUN })))
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
