import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelPlacement, declineInterest, decideArtworkSwap, proposeArtworkSwap, saveAdvertArtwork, saveAdvertFormats,
  saveBannerSpots, saveMediaPack, saveTakeoverPlacement, startAdvertFromInterest,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, sequence } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { invoicesTable } from "../stubs/invoices-table";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, uploadDocument, enqueue, removeMedia } = vi.hoisted(() => ({
  removeMedia: vi.fn<(path: string | null | undefined) => Promise<void>>(async () => {}),
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  uploadDocument: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, uploadDocument, removeMedia }));
vi.mock("@/lib/jobs", () => ({ enqueue, runQueuedJobSoon: vi.fn() }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
  uploadDocument.mockReset().mockResolvedValue(null);
  enqueue.mockReset().mockResolvedValue(undefined);
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

describe("saveAdvertArtwork", () => {
  it("requires a name, member and format", async () => {
    const from = db({});
    await saveAdvertArtwork(form({ name: "", member_id: "m1", format: "banner" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("a brand-new advert requires both images up front", async () => {
    uploadImage.mockResolvedValueOnce("panels/d.jpg").mockResolvedValueOnce(null);
    const from = db({});

    await expect(saveAdvertArtwork(form({ name: "Acme banner", member_id: "m1", format: "banner" })))
      .rejects.toThrow(/Both%20a%20desktop%20and%20a%20mobile%20image/);
    expect(from).not.toHaveBeenCalled();
  });

  it("an update leaves the images untouched when none are re-uploaded", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => advertsBuilder });

    await expect(saveAdvertArtwork(form({ id: "ad1", name: "Acme banner", member_id: "m1", format: "banner" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/artwork");

    const [payload] = (advertsBuilder.update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).not.toHaveProperty("desktop_path");
    expect(payload).not.toHaveProperty("mobile_path");
  });
});

// Review findings 16 Oct (link_url only checked by the browser; orphaned uploads).
describe("saveAdvertArtwork — link and uploads", () => {
  it("refuses a click-through link that isn't an http(s) web address, before uploading", async () => {
    const from = db({});
    await expect(saveAdvertArtwork(form({ name: "Acme banner", member_id: "m1", format: "banner", link_url: "javascript:alert(document.cookie)" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/artwork\/new\?error=The%20click-through%20link/);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("stores an accepted link normalised", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => advertsBuilder });
    await expect(saveAdvertArtwork(form({ id: "ad1", name: "Acme banner", member_id: "m1", format: "banner", link_url: "www.acme.co.uk" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/artwork");
    expect(advertsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ link_url: "https://www.acme.co.uk" }));
  });

  it("a new advert missing one image drops the one that did upload", async () => {
    uploadImage.mockResolvedValueOnce("panels/d.jpg").mockResolvedValueOnce(null);
    db({});
    await expect(saveAdvertArtwork(form({ name: "Acme banner", member_id: "m1", format: "banner" }))).rejects.toThrow(/Both%20a%20desktop/);
    expect(removeMedia).toHaveBeenCalledWith("panels/d.jpg");
  });
});

describe("saveTakeoverPlacement — uploads", () => {
  it("an edit of a takeover that's gone uploads nothing", async () => {
    uploadImage.mockResolvedValue("takeovers/new.jpg");
    db({ placements: () => queryBuilder(dbOk(null)) });
    await expect(saveTakeoverPlacement(form({ id: "t1", member_id: "m1", hex: "#003366", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/takeover\?error=That%20takeover%20no%20longer%20exists/);
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("a booking refused for overlap drops the banner it just uploaded", async () => {
    uploadImage.mockResolvedValue("takeovers/new.jpg");
    db({ placements: () => queryBuilder(dbError('violates exclusion constraint "placements_takeover_no_overlap"')) });
    await expect(saveTakeoverPlacement(form({ member_id: "m1", hex: "#003366", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/only%20one%20can%20run%20at%20a%20time/);
    expect(removeMedia).toHaveBeenCalledWith("takeovers/new.jpg");
  });

  it("an edit that fails keeps the stored banner and drops only the new upload", async () => {
    uploadImage.mockResolvedValue("takeovers/new.jpg");
    db({ placements: sequence<unknown>(dbOk({ config: { banner_path: "takeovers/old.jpg" } }), dbError("boom")) });
    await expect(saveTakeoverPlacement(form({ id: "t1", member_id: "m1", hex: "#003366", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/takeover\/t1\?error=That%20couldn't%20be%20saved/);
    expect(removeMedia).toHaveBeenCalledWith("takeovers/new.jpg");
    expect(removeMedia).not.toHaveBeenCalledWith("takeovers/old.jpg");
  });
});

describe("proposeArtworkSwap", () => {
  it("redirects back to the booking (not the artwork page) when one is given", async () => {
    uploadImage.mockResolvedValueOnce("panels/d.jpg").mockResolvedValueOnce("panels/m.jpg");
    db({ adverts: () => queryBuilder(dbOk(null)), advert_artwork_proposals: () => queryBuilder(dbOk({ id: "prop1" })), approvals: () => queryBuilder(dbOk(null)) });

    await expect(proposeArtworkSwap(form({ advert_id: "ad1", booking_id: "b1" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/b1");
  });

  it("records the swap as already-approved — an admin proposal applies immediately", async () => {
    uploadImage.mockResolvedValueOnce("panels/d.jpg").mockResolvedValueOnce("panels/m.jpg");
    const proposalsBuilder = queryBuilder(dbOk({ id: "prop1" }));
    const approvalsBuilder = queryBuilder(dbOk(null));
    db({ adverts: () => queryBuilder(dbOk(null)), advert_artwork_proposals: () => proposalsBuilder, approvals: () => approvalsBuilder });

    await expect(proposeArtworkSwap(form({ advert_id: "ad1" }))).rejects.toThrow(/NEXT_REDIRECT/);

    expect(proposalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
    expect(approvalsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "advert_artwork", decision: "approved" }));
  });
});

describe("saveBannerSpots", () => {
  it("stores a whole number of spots in the banner_spots setting", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });
    await expect(saveBannerSpots(form({ count: "8" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/banners?saved=1");
    expect(builder.upsert).toHaveBeenCalledWith({ key: "banner_spots", value: { count: 8 } });
  });

  it.each(["0", "-3", "2.5", "eight", ""])("refuses %j without writing — zero must never read as sold out", async (count) => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });
    await expect(saveBannerSpots(form({ count }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/banners\?error=/);
    expect(builder.upsert).not.toHaveBeenCalled();
  });
});

describe("startAdvertFromInterest", () => {
  it("does nothing for a request that no longer exists", async () => {
    db({ visibility_requests: () => queryBuilder(dbOk(null)) });
    await expect(startAdvertFromInterest(form({ id: "req1" }))).resolves.toBeUndefined();
  });

  it("confirms the request, notifies the member, invoices only a positive amount, and hands off to the artwork form", async () => {
    const invoicesBuilder = queryBuilder(dbOk({ id: "inv1" }));
    db({ visibility_requests: () => queryBuilder(dbOk({ id: "req1", member_id: "m1", product: "banner" })), invoices: () => invoicesBuilder });

    await expect(startAdvertFromInterest(form({ id: "req1", amount_pounds: "100" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/artwork/new?member_id=m1&from=interest");
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ amount_pennies: 10000 }));

    (invoicesBuilder.insert as ReturnType<typeof vi.fn>).mockClear();
    await expect(startAdvertFromInterest(form({ id: "req1" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
  });
});

// Review finding 16 Oct: the amount was Number()'d, so "1e5" was £100,000 and
// a third decimal place was rounded away. Same parser and limits as every price.
describe("startAdvertFromInterest — the amount", () => {
  it("refuses an amount that isn't plain pounds within the limits, before confirming anything", async () => {
    const from = db({});
    for (const amount_pounds of ["1e5", "12.345", "0.10", "1000000"]) {
      await expect(startAdvertFromInterest(form({ id: "req1", amount_pounds })))
        .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/interest\?error=Enter%20the%20price%20in%20pounds/);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("says so when the invoice couldn't be raised, instead of handing off as if it had", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ visibility_requests: () => queryBuilder(dbOk({ id: "req1", member_id: "m1", product: "banner" })), invoices: () => queryBuilder(dbError("boom")) });
    await expect(startAdvertFromInterest(form({ id: "req1", amount_pounds: "100" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/interest\?error=Confirmed%2C%20but%20the%20invoice/);
  });
});

describe("saveMediaPack", () => {
  it("does nothing when no file was uploaded", async () => {
    const from = db({});
    await saveMediaPack(form({}));
    expect(from).not.toHaveBeenCalled();
  });

  it("stores the pack path under settings", async () => {
    uploadDocument.mockResolvedValue("media-pack/pack.pdf");
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });

    await saveMediaPack(form({}));

    expect(builder.upsert).toHaveBeenCalledWith(expect.objectContaining({ key: "media_pack" }));
  });
});

describe("saveAdvertFormats", () => {
  it("refuses to save while any format is missing a name or detail", async () => {
    const from = db({});
    await saveAdvertFormats(form({}));
    expect(from).not.toHaveBeenCalled();
  });
});

describe("saveTakeoverPlacement", () => {
  it("rejects a malformed hex colour", async () => {
    await expect(saveTakeoverPlacement(form({ member_id: "m1", hex: "orange" })))
      .rejects.toThrow(/Enter%20a%206-digit%20hex%20colour/);
  });

  it("rejects a colour that fails WCAG AA contrast against white", async () => {
    await expect(saveTakeoverPlacement(form({ member_id: "m1", hex: "#ffffee" })))
      .rejects.toThrow(/too%20close%20to%20white/);
  });

  it("requires a banner image", async () => {
    await expect(saveTakeoverPlacement(form({ member_id: "m1", hex: "#003366" })))
      .rejects.toThrow(/A%20banner%20image%20is%20required/);
  });

  it("books the takeover with a passing colour and banner", async () => {
    uploadImage.mockResolvedValue("takeovers/b.jpg");
    const builder = queryBuilder(dbOk(null));
    db({ placements: () => builder });

    await expect(saveTakeoverPlacement(form({ member_id: "m1", hex: "#003366", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/takeover?saved=1");

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "takeover", config: { hex: "#003366", banner_path: "takeovers/b.jpg" } }));
  });

  // fix-list 76: a booked takeover can be edited.
  it("updates in place, keeping the stored banner when no new one is uploaded", async () => {
    const builder = queryBuilder(dbOk({ config: { hex: "#112233", banner_path: "takeovers/old.jpg" } }));
    db({ placements: () => builder });

    await expect(saveTakeoverPlacement(form({ id: "t1", member_id: "m1", hex: "#003366", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/takeover/t1?saved=1");

    expect(builder.insert).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({
      config: { hex: "#003366", banner_path: "takeovers/old.jpg" }, starts_on: "2026-10-01",
    }));
    expect(builder.eq).toHaveBeenCalledWith("id", "t1");
  });

  it("swaps the banner on an edit when a new one is uploaded", async () => {
    uploadImage.mockResolvedValue("takeovers/new.jpg");
    const builder = queryBuilder(dbOk({ config: { hex: "#112233", banner_path: "takeovers/old.jpg" } }));
    db({ placements: () => builder });

    await saveTakeoverPlacement(form({ id: "t1", member_id: "m1", hex: "#003366", starts_on: "2026-10-01", ends_on: "2026-10-31" })).catch(() => {});

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ config: { hex: "#003366", banner_path: "takeovers/new.jpg" } }));
  });

  it("sends an edit's validation errors back to the edit page", async () => {
    await expect(saveTakeoverPlacement(form({ id: "t1", member_id: "m1", hex: "orange" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/takeover\/t1\?error=/);
  });

  it("maps the overlap constraint to plain English on an edit", async () => {
    // first .from("placements") reads the stored config, the second is the update
    db({ placements: sequence<unknown>(dbOk({ config: { banner_path: "takeovers/old.jpg" } }), dbError('violates exclusion constraint "placements_takeover_no_overlap"')) });

    await expect(saveTakeoverPlacement(form({ id: "t1", member_id: "m1", hex: "#003366", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/only%20one%20can%20run%20at%20a%20time/);
  });
});

describe("decideArtworkSwap", () => {
  it("ignores a proposal that isn't pending", async () => {
    const from = db({ advert_artwork_proposals: () => queryBuilder(dbOk({ id: "prop1", status: "approved" })) });
    await decideArtworkSwap(form({ id: "prop1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  it("requires a reason to send changes back", async () => {
    db({ advert_artwork_proposals: () => queryBuilder(dbOk({ id: "prop1", advert_id: "ad1", status: "pending", advert: { member_id: "m1" } })) });
    await expect(decideArtworkSwap(form({ id: "prop1", decision: "reject" })))
      .rejects.toThrow(/Give%20the%20member%20a%20reason/);
  });

  it("approving swaps the live artwork in and notifies the member", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    const proposalsBuilder = queryBuilder(dbOk({
      id: "prop1", advert_id: "ad1", desktop_path: "d.jpg", mobile_path: "m.jpg", status: "pending", advert: { member_id: "m1" },
    }));
    db({ advert_artwork_proposals: () => proposalsBuilder, adverts: () => advertsBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideArtworkSwap(form({ id: "prop1", decision: "approve" }));

    expect(advertsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ desktop_path: "d.jpg", mobile_path: "m.jpg" }));
    expect(proposalsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_artwork_approved" }));
  });

  it("rejecting leaves the live artwork untouched", async () => {
    const advertsBuilder = queryBuilder(dbOk(null));
    const proposalsBuilder = queryBuilder(dbOk({
      id: "prop1", advert_id: "ad1", desktop_path: "d.jpg", mobile_path: "m.jpg", status: "pending", advert: { member_id: "m1" },
    }));
    db({ advert_artwork_proposals: () => proposalsBuilder, adverts: () => advertsBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideArtworkSwap(form({ id: "prop1", decision: "reject", reason: "Colours are off-brand" }));

    expect(advertsBuilder.update).not.toHaveBeenCalled();
    expect(proposalsBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", review_reason: "Colours are off-brand" }));
  });
});

describe("declineInterest", () => {
  it("notifies the member with the decline reason when there's a member to tell", async () => {
    db({ visibility_requests: () => queryBuilder(dbOk({ id: "req1", member_id: "m1" })) });

    await declineInterest(form({ id: "req1", reason: "Not the right fit right now" }));

    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "visibility_declined", reason: "Not the right fit right now" }));
  });
});

const TK = "44444444-4444-4444-8444-444444444444";
const takeover = (extra: Record<string, unknown> = {}) => ({
  id: TK, kind: "takeover", member_id: "m1", price_pennies: null, starts_on: "2099-09-01", ends_on: "2099-09-30",
  awaiting_payment: false, config: { hex: "#003366", banner_path: "takeovers/old.jpg" }, ...extra,
});

describe("takeover billing", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  // Review finding 20: priced holds were never tested.
  it("a priced new takeover is held, and its invoice is linked to the placement", async () => {
    uploadImage.mockResolvedValue("takeovers/b.jpg");
    const placements = queryBuilder(dbOk({ id: TK }));
    const invoices = invoicesTable(null, "inv5");
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveTakeoverPlacement(form({ member_id: "m1", hex: "#003366", starts_on: "2099-09-01", ends_on: "2099-09-30", price_pounds: "1500" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/takeover?saved=1");

    expect(placements.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "takeover", price_pennies: 150000, awaiting_payment: true }));
    expect(invoices.inserts()).toEqual([expect.objectContaining({ placement_id: TK, amount_pennies: 150000, member_id: "m1" })]);
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due", invoice_id: "inv5" }));
  });

  it("moving a held takeover to another advertiser re-issues its invoice to them", async () => {
    const placements = queryBuilder(dbOk(takeover({ member_id: "m2", price_pennies: 150000, awaiting_payment: true }), 0));
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 150000, status: "issued" }, "inv2");
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveTakeoverPlacement(form({ id: TK, member_id: "m2", hex: "#003366", starts_on: "2099-09-01", ends_on: "2099-09-30", price_pounds: "1500" })))
      .rejects.toThrow(`takeover/${TK}?saved=1`);

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(invoices.inserts()).toEqual([expect.objectContaining({ member_id: "m2", placement_id: TK })]);
  });

  it("a re-issue whose dates clash with another takeover is refused before the old invoice is voided", async () => {
    const placements = queryBuilder(dbOk(takeover({ price_pennies: 150000, awaiting_payment: true }), 1));
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 150000, status: "issued" });
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveTakeoverPlacement(form({ id: TK, member_id: "m2", hex: "#003366", starts_on: "2099-09-01", ends_on: "2099-09-30", price_pounds: "1500" })))
      .rejects.toThrow(/only%20one%20can%20run%20at%20a%20time/);
    expect(invoices.updates()).toEqual([]);
    expect(placements.update).not.toHaveBeenCalled();
  });

  it("a paid takeover can't change advertiser", async () => {
    const placements = queryBuilder(dbOk(takeover({ price_pennies: 150000 }), 0));
    db({ placements: () => placements, invoices: invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 150000, status: "paid" }).factory });
    await expect(saveTakeoverPlacement(form({ id: TK, member_id: "m2", hex: "#003366", starts_on: "2099-09-01", ends_on: "2099-09-30", price_pounds: "1500" })))
      .rejects.toThrow(/error=SMI-ADV-1%20has%20already%20been%20paid/);
    expect(placements.update).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it("cancelling a held takeover frees its dates and voids its invoice", async () => {
    const placements = queryBuilder(dbOk(takeover({ price_pennies: 150000, awaiting_payment: true })));
    const invoices = invoicesTable({ id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 150000, status: "issued" });
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(cancelPlacement(form({ id: TK, confirm: "1" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/takeover?cancelled=1");
    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(placements.delete).toHaveBeenCalled();
  });
});
