import { afterEach, describe, expect, it, vi } from "vitest";
import { decideMachine, saveFeaturedMemberPlacement, saveMachine, saveMachinePlacement } from "@/app/console/actions";
import { serviceDb } from "@/lib/db/server";
import { FEATURED_SLOTS } from "@/lib/pricing";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import type { CurrentUser } from "@/lib/auth";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireConsole, uploadImage, enqueue } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  uploadImage: vi.fn<(file: File | null, prefix: string) => Promise<string | null>>(async () => null),
  enqueue: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/media", () => ({ uploadImage, removeMedia: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

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
      .rejects.toThrow(/NEXT_REDIRECT:\/console\/adverts\/featured-member\?error=constraint%20violated/);
  });

  it("books the placement when under the cap", async () => {
    const placementsBuilder = queryBuilder(dbOk(null, 1));
    db({ placements: () => placementsBuilder });

    await saveFeaturedMemberPlacement(form({ member_id: "m1", starts_on: "2026-09-01", ends_on: "2026-09-30" }));

    expect(placementsBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ kind: "featured_member", member_id: "m1" }));
  });
});
