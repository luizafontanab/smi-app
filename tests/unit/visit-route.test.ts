import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/visit/[id]/route";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /visit/[id]", () => {
  it("sends a reader with an unknown advert id straight home", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(null)) })));

    await expect(GET(new Request("https://smi.local/visit/bogus"), ctx("bogus"))).rejects.toThrow("NEXT_REDIRECT:/");
    expect(record).not.toHaveBeenCalled();
  });

  it("records the click and sends the reader to the advert's own link when it has one", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: "https://acme.example", member: { id: "m1", slug: "acme" } })),
    })));

    await expect(GET(new Request("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow("NEXT_REDIRECT:https://acme.example");

    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_click", advert_id: "ad1", member_id: "m1" })]);
  });

  it("falls back to the advertiser's member page with no explicit link", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: () => queryBuilder(dbOk({ id: "ad1", link_url: null, member: { id: "m1", slug: "acme" } })),
    })));

    await expect(GET(new Request("https://smi.local/visit/ad1"), ctx("ad1"))).rejects.toThrow("NEXT_REDIRECT:/member/acme");
  });
});
