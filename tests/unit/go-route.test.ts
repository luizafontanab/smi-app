import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/go/[memberId]/route";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/**
 * The member contact-link click tracker. It reads through serviceDb, so RLS
 * does not hide an archived member from it the way it does from every public
 * page — the filter has to be in the route (fix list 72).
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { record, requestContext } = vi.hoisted(() => ({
  record: vi.fn(() => {}),
  requestContext: vi.fn(async () => ({ session_hash: "h", referrer: null, region: null, company: null, consented: true })),
}));
vi.mock("@/lib/analytics", () => ({ record, requestContext }));

afterEach(() => {
  resetDbServerMocks();
  record.mockClear();
  requestContext.mockClear();
});

const ctx = (memberId: string) => ({ params: Promise.resolve({ memberId }) });
const member = (over: Record<string, unknown> = {}) => ({
  id: "m1", slug: "acme", website: "https://acme.example", phone: "0114 000 0000",
  contact_email: "hi@acme.example", social: null, archived_at: null, ...over,
});

function db(row: unknown) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(row)) })));
}

describe("GET /go/[memberId]", () => {
  it("forwards a live member's website click and records it", async () => {
    db(member());

    await expect(GET(new Request("https://smi.local/go/m1?kind=website"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "outbound_click", member_id: "m1" })]);
  });

  it("sends an archived member's click home instead of onward", async () => {
    db(member({ archived_at: "2026-09-23T10:00:00Z" }));

    // Home, not /member/acme: that page 404s for everyone but an admin.
    await expect(GET(new Request("https://smi.local/go/m1?kind=website"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("records nothing for an archived member — the link should no longer exist", async () => {
    db(member({ archived_at: "2026-09-23T10:00:00Z" }));

    await expect(GET(new Request("https://smi.local/go/m1?kind=phone"), ctx("m1"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(record).not.toHaveBeenCalled();
  });

  it("still sends an unknown member home", async () => {
    db(null);

    await expect(GET(new Request("https://smi.local/go/nope?kind=website"), ctx("nope"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(record).not.toHaveBeenCalled();
  });
});
