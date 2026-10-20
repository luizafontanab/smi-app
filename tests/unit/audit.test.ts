import { afterEach, describe, expect, it, vi } from "vitest";
import { audit, memberAdminAccess, requestIp } from "@/lib/audit";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { requestHeaders, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
  logError.mockReset();
});

/** The audit_events builder, so a test can read back what audit() inserted. */
function stubInsert(result = dbOk(null)) {
  const builder = queryBuilder(result);
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ audit_events: () => builder }) })));
  return builder;
}
const inserted = (builder: ReturnType<typeof queryBuilder>) => vi.mocked(builder.insert as (row: unknown) => unknown).mock.calls[0]?.[0];

describe("audit", () => {
  it("records who did what to which member", async () => {
    const builder = stubInsert();

    await audit({ action: "view_as_start", actorUserId: "a1", actorRole: "admin", memberId: "m1" });

    expect(inserted(builder)).toEqual({ action: "view_as_start", actor_user_id: "a1", actor_role: "admin", member_id: "m1", detail: {}, ip: null });
  });

  it("keeps the IP for sign-in and credential events only", async () => {
    requestHeaders.set("x-forwarded-for", "203.0.113.7, 10.0.0.1");
    const signIn = stubInsert();
    await audit({ action: "sign_in", actorUserId: "u1", actorRole: "member", memberId: "m1" });
    expect(inserted(signIn)).toMatchObject({ ip: "203.0.113.7" });

    const viewAs = stubInsert();
    await audit({ action: "view_as_start", actorUserId: "a1", actorRole: "admin", memberId: "m1" });
    expect(inserted(viewAs)).toMatchObject({ ip: null });
  });

  it("never throws — a failed write goes to the error log instead", async () => {
    stubInsert(dbError("relation does not exist"));

    await expect(audit({ action: "sign_out", actorUserId: "u1" })).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "audit:sign_out" }));
  });
});

describe("requestIp", () => {
  it("takes the first forwarded address and refuses anything that isn't one", async () => {
    requestHeaders.set("x-forwarded-for", "2001:db8::1, 10.0.0.1");
    expect(await requestIp()).toBe("2001:db8::1");
    requestHeaders.set("x-forwarded-for", "<script>");
    expect(await requestIp()).toBeNull();
  });
});

describe("memberAdminAccess", () => {
  it("lists only admins' access to the member, newest first, with the admin's name", async () => {
    const events = queryBuilder(dbOk([
      { at: "2026-10-20T10:00:00Z", action: "view_as_start", actor_user_id: "a1", detail: {} },
      { at: "2026-10-19T09:00:00Z", action: "member_status_changed", actor_user_id: "gone", detail: { from: "draft", to: "active" } },
    ]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        audit_events: () => events,
        profiles: () => queryBuilder(dbOk([{ user_id: "a1", display_name: "Jas" }])),
      }),
    })));

    const rows = await memberAdminAccess("m1");

    // The member's own sign-ins are security data, not part of this view.
    expect(events.eq).toHaveBeenCalledWith("actor_role", "admin");
    expect(events.order).toHaveBeenCalledWith("at", { ascending: false });
    expect(rows).toEqual([
      { at: "2026-10-20T10:00:00Z", action: "view_as_start", actorName: "Jas", detail: {} },
      // a since-deleted admin keeps the row, just without a name
      { at: "2026-10-19T09:00:00Z", action: "member_status_changed", actorName: null, detail: { from: "draft", to: "active" } },
    ]);
  });

  it("returns nothing, and logs, when the read fails", async () => {
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ audit_events: () => queryBuilder(dbError("boom")) }) })));

    expect(await memberAdminAccess("m1")).toEqual([]);
    expect(logError).toHaveBeenCalled();
  });
});
