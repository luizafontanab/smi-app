import { afterEach, describe, expect, it, vi } from "vitest";
import { startViewAs, stopViewAs } from "@/app/view-as/actions";
import { serviceDb, sessionDb } from "@/lib/db/server";
import { VIEW_AS_COOKIE, VIEW_AS_MAX_AGE } from "@/lib/view-as";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { audit } = vi.hoisted(() => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit }));

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
  vi.restoreAllMocks();
  audit.mockClear();
});

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";

/** currentUser() reads `profiles`; startViewAs checks `members`. */
function stubSession(role: "admin" | "member", member: { id: string } | null = { id: MEMBER_ID }) {
  vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({
    auth: { getUser: vi.fn(async () => dbOk({ user: { id: "u1", email: "x@smi.local" } })) },
  })));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      profiles: () => queryBuilder(dbOk({ role, member_id: role === "member" ? "mem1" : null, display_name: null })),
      members: () => queryBuilder(dbOk(member)),
    }),
  })));
}

const form = (memberId: string) => {
  const fd = new FormData();
  fd.set("member_id", memberId);
  return fd;
};

describe("startViewAs", () => {
  it("refuses a member — only the console can start it", async () => {
    stubSession("member");

    await expect(startViewAs(form(MEMBER_ID))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(cookieStore.has(VIEW_AS_COOKIE)).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses a malformed member id", async () => {
    stubSession("admin");

    await expect(startViewAs(form("nope"))).rejects.toThrow("NEXT_REDIRECT:/console/members");
    expect(cookieStore.has(VIEW_AS_COOKIE)).toBe(false);
  });

  it("refuses a member that doesn't exist", async () => {
    stubSession("admin", null);

    await expect(startViewAs(form(MEMBER_ID))).rejects.toThrow("NEXT_REDIRECT:/console/members");
    expect(cookieStore.has(VIEW_AS_COOKIE)).toBe(false);
  });

  it("sets an httpOnly, site-wide, expiring cookie and opens the dashboard", async () => {
    stubSession("admin");
    const set = vi.spyOn(cookieStore, "set");

    await expect(startViewAs(form(MEMBER_ID))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(set).toHaveBeenCalledWith(VIEW_AS_COOKIE, MEMBER_ID, expect.objectContaining({
      httpOnly: true, sameSite: "lax", path: "/", maxAge: VIEW_AS_MAX_AGE,
    }));
    expect(cookieStore.get(VIEW_AS_COOKIE)?.value).toBe(MEMBER_ID);
    // admin access to member data is recorded (docs/GDPR.md §16)
    expect(audit).toHaveBeenCalledWith({ action: "view_as_start", actorUserId: "u1", actorRole: "admin", memberId: MEMBER_ID });
  });
});

describe("stopViewAs", () => {
  it("clears the cookie and returns to that member's console page", async () => {
    stubSession("admin");
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);

    await expect(stopViewAs()).rejects.toThrow(`NEXT_REDIRECT:/console/members/${MEMBER_ID}`);
    expect(cookieStore.has(VIEW_AS_COOKIE)).toBe(false);
    expect(audit).toHaveBeenCalledWith({ action: "view_as_stop", actorUserId: "u1", actorRole: "admin", memberId: MEMBER_ID });
  });

  it("returns to the member list when there was no valid cookie", async () => {
    stubSession("admin");

    await expect(stopViewAs()).rejects.toThrow("NEXT_REDIRECT:/console/members");
  });

  it("clears a stale cookie even for a non-admin, then sends them home", async () => {
    stubSession("member");
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);

    await expect(stopViewAs()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(cookieStore.has(VIEW_AS_COOKIE)).toBe(false);
  });
});
