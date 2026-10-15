import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelPlacement, decideMachine, raiseItemInvoice, saveFeaturedMemberPlacement, saveMachine, saveMachinePlacement } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, sequence } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { invoicesTable } from "../stubs/invoices-table";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

type Expire = { ok: true } | { ok: false; status: string | null; error: string };
const { requireConsole, uploadImage, enqueue, expireCheckoutSession } = vi.hoisted(() => ({
  // as the real one answers with no Stripe key; a test overrides it per call
  expireCheckoutSession: vi.fn(async (): Promise<Expire> => ({ ok: false, status: null, error: "Online payments are not configured." })),
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue, runQueuedJobSoon: vi.fn() }));
vi.mock("@/lib/adapters/advert-checkout", async (orig) => ({ ...(await orig<typeof import("@/lib/adapters/advert-checkout")>()), expireCheckoutSession }));

afterEach(() => {
  resetDbServerMocks();
  uploadImage.mockReset().mockResolvedValue(null);
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

describe("saveMachine", () => {
  // See the note in console-actions-stories.test.ts — fix-list 73 turned these
  // silent returns into a redirect that tells you what is missing.
  it("requires a name and a seller (member) attribution, and says so", async () => {
    const from = db({});
    await expect(saveMachine(form({ name: "Laser cutter", member_id: "" }))).rejects.toThrow(/NEXT_REDIRECT.*error=/);
    expect(from).not.toHaveBeenCalled();
  });

  it("publishes directly — no approval step for admin-created machines", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1" }));
    db({ featured_machines: () => machinesBuilder });

    await expect(saveMachine(form({ name: "Laser cutter", member_id: "m1" }))).rejects.toThrow("NEXT_REDIRECT:/console/machines/mc1");

    expect(machinesBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "published", source: "admin" }));
  });

  // GAPS A9.4: an optional YouTube video on the listing.
  it("stores a YouTube video, and null when the field is left blank", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1" }));
    db({ featured_machines: () => machinesBuilder });

    await expect(saveMachine(form({ id: "mc1", name: "Laser", member_id: "m1", video_url: "https://youtu.be/abc123" }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(machinesBuilder.update).toHaveBeenLastCalledWith(expect.objectContaining({ video_url: "https://youtu.be/abc123" }));

    await expect(saveMachine(form({ id: "mc1", name: "Laser", member_id: "m1", video_url: " " }))).rejects.toThrow(/NEXT_REDIRECT/);
    expect(machinesBuilder.update).toHaveBeenLastCalledWith(expect.objectContaining({ video_url: null }));
  });

  it("refuses a video link that isn't YouTube, without writing", async () => {
    const from = db({});
    await expect(saveMachine(form({ id: "mc1", name: "Laser", member_id: "m1", video_url: "https://vimeo.com/1" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/machines\/mc1\?error=.*YouTube/);
    expect(from).not.toHaveBeenCalled();
  });
});

describe("decideMachine", () => {
  it("ignores a machine that isn't awaiting approval", async () => {
    const from = db({ featured_machines: () => queryBuilder(dbOk({ id: "mc1", status: "published" })) });
    await decideMachine(form({ id: "mc1", decision: "approve" }));
    expect(from).not.toHaveBeenCalledWith("approvals");
  });

  it("rejects with a reason and notifies the member", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1", member_id: "m1", status: "awaiting_approval" }));
    db({ featured_machines: () => machinesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideMachine(form({ id: "mc1", decision: "reject", reason: "Needs a clearer photo" }));

    expect(machinesBuilder.update).toHaveBeenCalledWith({ status: "rejected", rejected_reason: "Needs a clearer photo" });
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "machine_rejected", reason: "Needs a clearer photo" }));
  });

  it("approving carries no reason into the member notification", async () => {
    const machinesBuilder = queryBuilder(dbOk({ id: "mc1", member_id: "m1", status: "awaiting_approval" }));
    db({ featured_machines: () => machinesBuilder, approvals: () => queryBuilder(dbOk(null)) });

    await decideMachine(form({ id: "mc1", decision: "approve" }));

    expect(enqueue).toHaveBeenCalledWith("notify_member", { member_id: "m1", kind: "machine_live", machine_id: "mc1" });
  });
});

describe("saveMachinePlacement", () => {
  it("refuses to place a machine that isn't published yet", async () => {
    const from = db({ featured_machines: () => queryBuilder(dbOk({ member_id: "m1", status: "awaiting_approval" })) });
    await saveMachinePlacement(form({ machine_id: "mc1", starts_on: "2026-09-01", ends_on: "2026-09-30" }));
    expect(from).not.toHaveBeenCalledWith("placements");
  });

  it("books the placement under the machine's own member", async () => {
    const placementsBuilder = queryBuilder(dbOk(null));
    db({ featured_machines: () => queryBuilder(dbOk({ member_id: "m1", status: "published" })), placements: () => placementsBuilder });

    await saveMachinePlacement(form({ machine_id: "mc1", starts_on: "2026-09-01", ends_on: "2026-09-30" }));

    expect(placementsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "featured_machine", member_id: "m1" }));
  });
});

describe("saveFeaturedMemberPlacement", () => {
  it("refuses once the cap for the term is already full", async () => {
    // The constant, not a literal: this test is about the cap being full, not
    // about the number 4. It went to 8 on 20 Sep and a hardcoded count would
    // have stopped tripping the guard while still passing for the wrong reason.
    const from = db({ placements: () => queryBuilder(dbOk(null, FEATURED_SLOTS.cap)) });

    await expect(saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/featured-member\?error=/);
    expect(from).not.toHaveBeenCalledWith("placements", expect.anything());
  });

  it("reports the database error rather than a silent failure", async () => {
    db({ placements: () => queryBuilder(() => ({ data: null, error: null, count: 0 })) });
    // override just the insert to fail, everything else (the count check) succeeds
    const placementsBuilder = queryBuilder(dbError("constraint violated"));
    db({ placements: () => placementsBuilder });

    await expect(saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/featured-member\?error=That%20couldn't%20be%20saved/);
  });

  it("books the placement when under the cap", async () => {
    const placementsBuilder = queryBuilder(dbOk(null, 1));
    db({ placements: () => placementsBuilder });

    await expect(saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2026-09-01", ends_on: "2026-09-30" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/featured-member?saved=1");

    expect(placementsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "featured_member", member_id: "m1" }));
  });

  // fix-list 76: a booked slot can be edited.
  it("edits a slot in place, not counting it against its own cap", async () => {
    // existence check → overlap count → the update
    let n = 0;
    const steps = [dbOk({ id: "pl1" }), dbOk(null, FEATURED_SLOTS.cap - 1), dbOk({ id: "pl1" })];
    const placementsBuilder = queryBuilder(() => steps[Math.min(n++, steps.length - 1)]);
    db({ placements: () => placementsBuilder });

    await expect(saveFeaturedMemberPlacement(form({ id: "pl1", member_id: "m2", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/featured-member/pl1?saved=1");

    expect(placementsBuilder.neq).toHaveBeenCalledWith("id", "pl1");
    expect(placementsBuilder.insert).not.toHaveBeenCalled();
    expect(placementsBuilder.update).toHaveBeenCalledWith({ member_id: "m2", starts_on: "2026-10-01", ends_on: "2026-10-31", price_pennies: null });
    expect(placementsBuilder.eq).toHaveBeenCalledWith("id", "pl1");
  });

  it("sends an edit that would overfill the term back to the edit page", async () => {
    db({ placements: sequence(dbOk({ id: "pl1" }), dbOk(null, FEATURED_SLOTS.cap)) });

    await expect(saveFeaturedMemberPlacement(form({ id: "pl1", member_id: "m1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/featured-member\/pl1\?error=/);
  });
});

// Review finding 16 Oct: an edit of a slot that's been deleted used to report
// ?saved=1 — the update matched nothing and maybeSingle said so with no error.
describe("saveFeaturedMemberPlacement — a slot that no longer exists", () => {
  it("says so before writing anything", async () => {
    const placementsBuilder = queryBuilder(dbOk(null));
    db({ placements: () => placementsBuilder });
    await expect(saveFeaturedMemberPlacement(form({ id: "pl1", member_id: "m1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/featured-member\?error=That%20Featured%20Member%20slot%20no%20longer%20exists/);
    expect(placementsBuilder.update).not.toHaveBeenCalled();
  });

  it("and if it goes between the check and the save", async () => {
    db({ placements: sequence(dbOk({ id: "pl1" }), dbOk(null, 0), dbOk(null)) });
    await expect(saveFeaturedMemberPlacement(form({ id: "pl1", member_id: "m1", starts_on: "2026-10-01", ends_on: "2026-10-31" })))
      .rejects.toThrow(/featured-member\?error=That%20Featured%20Member%20slot%20no%20longer%20exists/);
  });
});

const PL = "33333333-3333-4333-8333-333333333333";
const slot = (extra: Record<string, unknown> = {}) => ({
  id: PL, kind: "featured_member", member_id: "m1", price_pennies: null, starts_on: "2099-10-01", ends_on: "2099-10-31", awaiting_payment: false, ...extra,
});
const ISSUED = { id: "inv1", number: "SMI-ADV-1", member_id: "m1", amount_pennies: 40000, status: "issued" as const };
const PAID = { ...ISSUED, status: "paid" as const };

describe("Featured Member billing", () => {
  // Payments run "simulated" under test, so a priced slot is held — pinned so
  // a Stripe key in .env.local can't change that.
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  // Review finding 20: priced holds were never tested — only price_pennies: null.
  it("a priced new slot is held, and its invoice is linked to the placement", async () => {
    const placements = queryBuilder(dbOk({ id: PL }, 0));
    const invoices = invoicesTable(null, "inv9");
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "400" })))
      .rejects.toThrow("NEXT_REDIRECT:/console/adverts/featured-member?saved=1");

    expect(placements.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "featured_member", price_pennies: 40000, awaiting_payment: true }));
    expect(invoices.inserts()).toEqual([expect.objectContaining({ placement_id: PL, member_id: "m1", amount_pennies: 40000, status: "issued" })]);
    expect(enqueue).toHaveBeenCalledWith("notify_member", expect.objectContaining({ kind: "advert_payment_due", invoice_id: "inv9" }));
  });

  it("a new slot whose invoice fails says so on the slot's page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ placements: () => queryBuilder(dbOk({ id: PL }, 0)), invoices: () => queryBuilder(dbError("boom")) });
    await expect(saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "400" })))
      .rejects.toThrow(new RegExp(`featured-member/${PL}\\?error=Saved%2C%20but%20the%20invoice`));
  });

  it("a price outside Stripe's limits is refused with them spelled out", async () => {
    const from = db({});
    await expect(saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "0.10" })))
      .rejects.toThrow(/error=Enter%20the%20price%20in%20pounds.*%C2%A30\.30.*%C2%A3999%2C999\.99/);
    expect(from).not.toHaveBeenCalled();
  });

  // Review finding 5 (user decision: re-issue): the invoice stayed with the old
  // member, so their payment released the new member's slot.
  it("moving a held slot to another member voids the old member's invoice and bills the new one", async () => {
    const placements = queryBuilder(dbOk(slot({ member_id: "m2", price_pennies: 40000, awaiting_payment: true }), 0));
    const invoices = invoicesTable(ISSUED, "inv2");
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveFeaturedMemberPlacement(form({ id: PL, member_id: "m2", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "400" })))
      .rejects.toThrow(`featured-member/${PL}?saved=1`);

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(invoices.inserts()).toEqual([expect.objectContaining({ member_id: "m2", placement_id: PL, amount_pennies: 40000 })]);
  });

  it("a paid slot can't move to another member — refused before anything is written", async () => {
    const placements = queryBuilder(dbOk(slot({ price_pennies: 40000 }), 0));
    db({ placements: () => placements, invoices: invoicesTable(PAID).factory });

    await expect(saveFeaturedMemberPlacement(form({ id: PL, member_id: "m2", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "400" })))
      .rejects.toThrow(/error=SMI-ADV-1%20has%20already%20been%20paid/);
    expect(placements.update).not.toHaveBeenCalled();
  });

  it("a member paying the old invoice right now stops the change", async () => {
    // Stripe says the open checkout has completed: voidInvoices leaves it issued, as `paying`
    expireCheckoutSession.mockResolvedValueOnce({ ok: false, status: "complete", error: "paid" });
    const placements = queryBuilder(dbOk(slot({ price_pennies: 40000, awaiting_payment: true }), 0));
    const invoices = queryBuilder(() => dbOk([{ ...ISSUED, checkout_session_id: "cs_1" }]));
    db({ placements: () => placements, invoices: () => invoices });

    await expect(saveFeaturedMemberPlacement(form({ id: PL, member_id: "m2", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "400" })))
      .rejects.toThrow(/error=The%20member%20is%20paying%20the%20current%20invoice%20right%20now/);
    expect(placements.update).not.toHaveBeenCalled();
    expect(invoices.update).not.toHaveBeenCalled();
  });

  it("a price added to an unpriced slot that hasn't started is billed and the slot held", async () => {
    const placements = queryBuilder(dbOk(slot({ price_pennies: 40000 }), 0));
    const invoices = invoicesTable();
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveFeaturedMemberPlacement(form({ id: PL, member_id: "m1", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "400" })))
      .rejects.toThrow(`featured-member/${PL}?saved=1`);

    expect(invoices.inserts()).toEqual([expect.objectContaining({ placement_id: PL, amount_pennies: 40000 })]);
    expect(placements.update).toHaveBeenCalledWith({ awaiting_payment: true });
  });

  it("taking the price off a held slot cancels its invoice and releases it", async () => {
    const placements = queryBuilder(dbOk(slot({ awaiting_payment: true }), 0));
    const invoices = invoicesTable(ISSUED);
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(saveFeaturedMemberPlacement(form({ id: PL, member_id: "m1", starts_on: "2099-10-01", ends_on: "2099-10-31", price_pounds: "" })))
      .rejects.toThrow(`featured-member/${PL}?saved=1`);

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(placements.update).toHaveBeenCalledWith({ awaiting_payment: false });
  });
});

// Review finding 6 (user decision: build it): no way to call off an unpaid
// slot or takeover — a held takeover reserved its dates against everyone.
describe("cancelPlacement", () => {
  it("deletes a held slot after voiding its invoice", async () => {
    const placements = queryBuilder(dbOk(slot({ awaiting_payment: true })));
    const invoices = invoicesTable(ISSUED);
    db({ placements: () => placements, invoices: invoices.factory });

    await expect(cancelPlacement(form({ id: PL, confirm: "1" }))).rejects.toThrow("NEXT_REDIRECT:/console/adverts/featured-member?cancelled=1");

    expect(invoices.updates()).toEqual([expect.objectContaining({ status: "void" })]);
    expect(placements.delete).toHaveBeenCalled();
    expect(placements.eq).toHaveBeenCalledWith("id", PL);
  });

  it("needs the confirm box", async () => {
    const placements = queryBuilder(dbOk(slot({ awaiting_payment: true })));
    db({ placements: () => placements });
    await expect(cancelPlacement(form({ id: PL }))).rejects.toThrow(/error=Tick%20the%20box/);
    expect(placements.delete).not.toHaveBeenCalled();
  });

  it("refuses a paid one — refunds are by hand", async () => {
    const placements = queryBuilder(dbOk(slot({ awaiting_payment: false })));
    db({ placements: () => placements, invoices: invoicesTable(PAID).factory });
    await expect(cancelPlacement(form({ id: PL, confirm: "1" }))).rejects.toThrow(/error=SMI-ADV-1%20is%20already%20paid/);
    expect(placements.delete).not.toHaveBeenCalled();
  });

  it("refuses one that's already running unheld", async () => {
    const placements = queryBuilder(dbOk(slot({ starts_on: "2020-01-01", awaiting_payment: false })));
    db({ placements: () => placements });
    await expect(cancelPlacement(form({ id: PL, confirm: "1" }))).rejects.toThrow(/error=This%20one%20has%20already%20started/);
    expect(placements.delete).not.toHaveBeenCalled();
  });

  it("a booking that's gone is said so", async () => {
    db({ placements: () => queryBuilder(dbOk(null)) });
    await expect(cancelPlacement(form({ id: PL, confirm: "1" }))).rejects.toThrow(/\/console\/adverts\?error=That%20booking%20no%20longer%20exists/);
  });
});

describe("raiseItemInvoice", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("raises the missing invoice for a priced slot, once, however often it's clicked", async () => {
    const invoices = invoicesTable(null, "inv7");
    db({ placements: () => queryBuilder(dbOk(slot({ price_pennies: 40000, awaiting_payment: true }))), invoices: invoices.factory });
    const back = `/console/adverts/featured-member/${PL}`;
    await expect(raiseItemInvoice(form({ kind: "placement", id: PL, return_to: back }))).rejects.toThrow(`${back}?saved=1`);
    expect(invoices.inserts()).toHaveLength(1);
  });

  it("says when there's nothing to invoice", async () => {
    db({ placements: () => queryBuilder(dbOk(slot())), invoices: invoicesTable().factory });
    await expect(raiseItemInvoice(form({ kind: "placement", id: PL, return_to: "/console/adverts" })))
      .rejects.toThrow(/error=There's%20nothing%20to%20invoice/);
  });

  it("refuses a target it doesn't know, and only returns to the console", async () => {
    const from = db({});
    await expect(raiseItemInvoice(form({ kind: "member", id: PL, return_to: "https://evil.example" })))
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\?error=/);
    expect(from).not.toHaveBeenCalled();
  });
});
