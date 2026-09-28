// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/seen/route";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { requestHeaders, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { record, requestContext } = vi.hoisted(() => ({
  record: vi.fn(),
  requestContext: vi.fn(async () => ({ consented: true, session_hash: "s", referrer_kind: "other" })),
}));
vi.mock("@/lib/analytics", () => ({ record, requestContext }));

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
  vi.clearAllMocks();
});

const ADVERT = "22222222-2222-4222-8222-222222222222";

const beacon = (items: unknown) =>
  new Request("http://localhost/api/seen", { method: "POST", body: JSON.stringify({ items }) });

function liveBookingDb() {
  const from = vi.fn(() => queryBuilder(dbOk([{ advert_id: ADVERT }])));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("POST /api/seen", () => {
  it("records an impression for a live booking, with its path, and always answers 204", async () => {
    liveBookingDb();
    const res = await POST(beacon([{ id: ADVERT, path: "/news" }]));
    expect(res.status).toBe(204);
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_impression", advert_id: ADVERT, path: "/news" })]);
  });

  // Decision D1 (28 Sep): impressions count with or without cookie consent,
  // but a declined visitor's row carries nothing that identifies them.
  it("counts an impression from a visitor who declined cookies, with no identifying data", async () => {
    liveBookingDb();
    requestContext.mockResolvedValueOnce({ consented: false, session_hash: "should-not-appear", referrer: "https://x.example", region: "r", company: "c" } as never);

    await POST(beacon([{ id: ADVERT, path: "/news" }]));

    const [rows] = record.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(rows).toEqual([{ kind: "ad_impression", advert_id: ADVERT, path: "/news", session_hash: null, referrer: null, region: null, company: null }]);
    // never flagged `consented: false`, which is what record() drops
    expect(rows[0]).not.toHaveProperty("consented");
  });

  it("keeps a consenting visitor's session context on the impression", async () => {
    liveBookingDb();
    await POST(beacon([{ id: ADVERT, path: "/news" }]));
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ session_hash: "s" })]);
  });

  it("falls back to \"unknown\" for an item with no path", async () => {
    liveBookingDb();
    // deliberately malformed, same as a stale cached client bundle mid-deploy
    await POST(beacon([{ id: ADVERT }]));
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ advert_id: ADVERT, path: "unknown" })]);
  });

  it("drops non-uuid and duplicate ids before touching the database", async () => {
    const from = liveBookingDb();
    await POST(beacon([{ id: "x,status.eq.live", path: "/news" }, { id: ADVERT, path: "/news" }, { id: ADVERT, path: "/video" }]));
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("rate-limits repetition: a caller looping the beacon stops being counted", async () => {
    liveBookingDb();
    // distinct IP per test file run — the limiter is process-global
    requestHeaders.set("x-forwarded-for", `9.9.9.${Math.floor(Math.random() * 200) + 1}`);

    let counted = 0;
    for (let i = 0; i < 40; i++) {
      record.mockClear();
      const res = await POST(beacon([{ id: ADVERT, path: "/news" }]));
      // impressions are billable: the limiter must be invisible to the client
      expect(res.status).toBe(204);
      if (record.mock.calls.length > 0) counted += 1;
    }
    expect(counted).toBeLessThanOrEqual(30);
    expect(counted).toBeGreaterThan(0);
  });
});
