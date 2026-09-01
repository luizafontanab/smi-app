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

const beacon = (ids: unknown) =>
  new Request("http://localhost/api/seen", { method: "POST", body: JSON.stringify({ ids }) });

function liveBookingDb() {
  const from = vi.fn(() => queryBuilder(dbOk([{ advert_id: ADVERT }])));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  return from;
}

describe("POST /api/seen", () => {
  it("records an impression for a live booking and always answers 204", async () => {
    liveBookingDb();
    const res = await POST(beacon([ADVERT]));
    expect(res.status).toBe(204);
    expect(record).toHaveBeenCalledWith([expect.objectContaining({ kind: "ad_impression", advert_id: ADVERT })]);
  });

  it("drops non-uuid and duplicate ids before touching the database", async () => {
    const from = liveBookingDb();
    await POST(beacon(["x,status.eq.live", ADVERT, ADVERT]));
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("rate-limits repetition: a caller looping the beacon stops being counted", async () => {
    liveBookingDb();
    // distinct IP per test file run — the limiter is process-global
    requestHeaders.set("x-forwarded-for", `9.9.9.${Math.floor(Math.random() * 200) + 1}`);

    let counted = 0;
    for (let i = 0; i < 40; i++) {
      record.mockClear();
      const res = await POST(beacon([ADVERT]));
      // impressions are billable: the limiter must be invisible to the client
      expect(res.status).toBe(204);
      if (record.mock.calls.length > 0) counted += 1;
    }
    expect(counted).toBeLessThanOrEqual(30);
    expect(counted).toBeGreaterThan(0);
  });
});
