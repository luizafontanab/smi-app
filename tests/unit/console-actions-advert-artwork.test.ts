import { afterEach, describe, expect, it, vi } from "vitest";
import {
  declineInterest, decideArtworkSwap, deleteAdvertProduct, proposeArtworkSwap, saveAdvertArtwork, saveAdvertFormats,
  saveAdvertProduct, saveBannerSpots, saveMediaPack, saveTakeoverPlacement, startAdvertFromInterest,
} from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, uploadDocument, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  uploadDocument: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, uploadDocument, removeMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
  uploadDocument.mockReset().mockResolvedValue(null);
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

describe("saveAdvertProduct", () => {
  it("requires a short_name and format", async () => {
    const from = db({});
    await saveAdvertProduct(form({ short_name: "", format: "banner" }));
    expect(from).not.toHaveBeenCalled();
  });

  it("converts pounds to pennies, and treats a blank rate as free/unpriced", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ advert_products: () => builder });

    await expect(saveAdvertProduct(form({ short_name: "Homepage banner", format: "banner", rate_pounds: "75.50" })))
      .rejects.toThrow(/NEXT_REDIRECT/);
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ rate_pennies: 7550 }));

    await saveAdvertProduct(form({ id: "p1", short_name: "Free slot", format: "banner", rate_pounds: "" })).catch(() => {});
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ rate_pennies: null }));
  });

  it("floors cap at 1, however it's entered", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ advert_products: () => builder });

    await saveAdvertProduct(form({ short_name: "x", format: "banner", cap: "0" })).catch(() => {});
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ cap: 1 }));
  });
});

describe("deleteAdvertProduct", () => {
  it("archives instead of deleting once a booking references it", async () => {
    const builder = queryBuilder(dbOk(null, 2));
    db({ advert_bookings: () => queryBuilder(dbOk(null, 2)), advert_products: () => builder });

    await deleteAdvertProduct(form({ id: "p1" }));

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
    expect(builder.delete).not.toHaveBeenCalled();
  });

  it("deletes outright when nothing references it", async () => {
    const builder = queryBuilder(dbOk(null, 0));
    db({ advert_bookings: () => queryBuilder(dbOk(null, 0)), advert_products: () => builder });

    await deleteAdvertProduct(form({ id: "p1" }));

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.update).not.toHaveBeenCalled();
  });
});

describe("saveBannerSpots", () => {
  it("stores a whole number of spots in the banner_spots setting", async () => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });
    await expect(saveBannerSpots(form({ count: "8" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/spots?saved=1");
    expect(builder.upsert).toHaveBeenCalledWith({ key: "banner_spots", value: { count: 8 } });
  });

  it.each(["0", "-3", "2.5", "eight", ""])("refuses %j without writing — zero must never read as sold out", async (count) => {
    const builder = queryBuilder(dbOk(null));
    db({ settings: () => builder });
    await expect(saveBannerSpots(form({ count }))).rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/spots\?error=/);
    expect(builder.upsert).not.toHaveBeenCalled();
  });
});

describe("startAdvertFromInterest", () => {
  it("does nothing for a request that no longer exists", async () => {
    db({ visibility_requests: () => queryBuilder(dbOk(null)) });
    await expect(startAdvertFromInterest(form({ id: "req1" }))).resolves.toBeUndefined();
  });

  it("confirms the request, notifies the member, invoices only a positive amount, and hands off to the artwork form", async () => {
    const invoicesBuilder = queryBuilder(dbOk(null));
    db({ visibility_requests: () => queryBuilder(dbOk({ id: "req1", member_id: "m1", product: "banner" })), invoices: () => invoicesBuilder });

    await expect(startAdvertFromInterest(form({ id: "req1", amount_pounds: "100" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/artwork/new?member_id=m1&from=interest");
    expect(invoicesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ amount_pennies: 10000 }));

    (invoicesBuilder.insert as ReturnType<typeof vi.fn>).mockClear();
    await expect(startAdvertFromInterest(form({ id: "req1" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(invoicesBuilder.insert).not.toHaveBeenCalled();
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

    await saveTakeoverPlacement(form({ member_id: "m1", hex: "#003366", starts_on: "2026-09-01", ends_on: "2026-09-30" }));

    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "takeover", config: { hex: "#003366", banner_path: "takeovers/b.jpg" } }));
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
