import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdmin, requireConsole, requireMember, requireMemberView, type CurrentUser } from "@/lib/auth";
import { serviceDb, sessionDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { cookieStore, requestHeaders, resetNextHeadersMocks } from "../stubs/next-headers";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  resetNextHeadersMocks();
});

type Profile = { role: "admin" | "member"; member_id: string | null; display_name: string | null };

/** Wires sessionDb().auth.getUser() and serviceDb()'s profile lookup the way currentUser() expects. */
function stubSession(user: { id: string; email: string } | null, profile: Profile | null = null) {
  vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({
    auth: { getUser: vi.fn(async () => dbOk({ user })) },
  })));
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk(profile)) })));
}

describe("requireConsole", () => {
  it("returns the user when they're a logged-in admin", async () => {
    stubSession({ id: "u1", email: "a@smi.local" }, { role: "admin", member_id: null, display_name: "Admin" });

    const user = await requireConsole();
    expect(user).toMatchObject({ userId: "u1", role: "admin" });
  });

  it("redirects to login when there's no session", async () => {
    stubSession(null);

    await expect(requireConsole()).rejects.toThrow("NEXT_REDIRECT:/login?next=/console");
  });

  it("redirects a logged-in non-admin to the member dashboard", async () => {
    stubSession({ id: "u1", email: "m@smi.local" }, { role: "member", member_id: "mem1", display_name: "Member" });

    await expect(requireConsole()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });
});

describe("requireMember", () => {
  it("returns the user when they're a logged-in member with a member record", async () => {
    stubSession({ id: "u1", email: "m@smi.local" }, { role: "member", member_id: "mem1", display_name: "Member" });

    const user = await requireMember();
    expect(user).toMatchObject({ userId: "u1", role: "member", memberId: "mem1" });
  });

  it("redirects to login when there's no session", async () => {
    stubSession(null);

    await expect(requireMember()).rejects.toThrow("NEXT_REDIRECT:/login?next=/dashboard");
  });

  it("redirects an admin (not a member) to the console", async () => {
    stubSession({ id: "u1", email: "a@smi.local" }, { role: "admin", member_id: null, display_name: "Admin" });

    await expect(requireMember()).rejects.toThrow("NEXT_REDIRECT:/console");
  });

  it("redirects a member with no linked member record to the console", async () => {
    // shouldn't happen in practice, but currentUser() alone can't rule it out
    stubSession({ id: "u1", email: "m@smi.local" }, { role: "member", member_id: null, display_name: null });

    await expect(requireMember()).rejects.toThrow("NEXT_REDIRECT:/console");
  });
});

describe("isAdmin", () => {
  const user = (over: Partial<CurrentUser> = {}): CurrentUser => ({
    userId: "u1", email: "a@smi.local", role: "member", memberId: null, displayName: null, ...over,
  });

  it("is true only for an admin role", () => {
    expect(isAdmin(user({ role: "admin" }))).toBe(true);
    expect(isAdmin(user({ role: "member" }))).toBe(false);
  });

  it("is false for no user at all", () => {
    expect(isAdmin(null)).toBe(false);
  });
});

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN: Profile = { role: "admin", member_id: null, display_name: "Jas" };
const MEMBER: Profile = { role: "member", member_id: "mem1", display_name: "Member" };

/**
 * stubSession, but table-routed: the view-as path reads `members` (does the
 * member still exist?) and `profiles` twice — the signed-in user's role, then
 * the viewed member's logins, whose emails come from auth.admin.getUserById.
 */
function stubViewAsSession(
  user: { id: string; email: string },
  profile: Profile,
  { member = { id: MEMBER_ID } as { id: string } | null, loginEmail = "acme@example.com" } = {},
) {
  vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({
    auth: { getUser: vi.fn(async () => dbOk({ user })) },
  })));
  let profileReads = 0;
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      // first read is currentUser()'s single row; the next is memberLogins()' list
      profiles: () => queryBuilder<unknown>(profileReads++ === 0 ? dbOk(profile) : dbOk([{ user_id: "login1" }])),
      members: () => queryBuilder(dbOk(member)),
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => dbOk({ user: { id: "login1", email: loginEmail, last_sign_in_at: null } })),
      },
    },
  })));
}

describe("requireMemberView", () => {
  it("gives a member their own id and email, not viewing-as", async () => {
    stubSession({ id: "u1", email: "m@smi.local" }, MEMBER);

    expect(await requireMemberView()).toEqual({ memberId: "mem1", email: "m@smi.local", viewingAs: null });
  });

  it("ignores a view-as cookie a member sets themselves", async () => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    stubSession({ id: "u1", email: "m@smi.local" }, MEMBER);

    expect(await requireMemberView()).toMatchObject({ memberId: "mem1", viewingAs: null });
  });

  it("redirects to login when there's no session", async () => {
    stubSession(null);

    await expect(requireMemberView()).rejects.toThrow("NEXT_REDIRECT:/login?next=/dashboard");
  });

  it("sends an admin with no view-as cookie to the console, as before", async () => {
    stubSession({ id: "a1", email: "jas@smi.local" }, ADMIN);

    await expect(requireMemberView()).rejects.toThrow("NEXT_REDIRECT:/console");
  });

  it("sends an admin with a malformed cookie to the console", async () => {
    cookieStore.set(VIEW_AS_COOKIE, "not-a-uuid");
    stubSession({ id: "a1", email: "jas@smi.local" }, ADMIN);

    await expect(requireMemberView()).rejects.toThrow("NEXT_REDIRECT:/console");
  });

  it("sends an admin back to the member list when the viewed member no longer exists", async () => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    stubViewAsSession({ id: "a1", email: "jas@smi.local" }, ADMIN, { member: null });

    await expect(requireMemberView()).rejects.toThrow("NEXT_REDIRECT:/console/members");
  });

  it("gives an admin viewing as a member that member's id and login email", async () => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    stubViewAsSession({ id: "a1", email: "jas@smi.local" }, ADMIN);

    expect(await requireMemberView()).toEqual({
      memberId: MEMBER_ID,
      email: "acme@example.com",
      viewingAs: { adminUserId: "a1", adminName: "Jas" },
    });
  });
});

describe("requireMember while viewing as a member", () => {
  // Every member action opens with requireMember(): view-as stays read-only
  // because an admin never gets through, cookie or not.
  it("refuses the admin, bouncing back to the dashboard page they were on", async () => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    requestHeaders.set("referer", "http://localhost:3100/dashboard/profile?tab=details");
    stubSession({ id: "a1", email: "jas@smi.local" }, ADMIN);

    await expect(requireMember()).rejects.toThrow("NEXT_REDIRECT:/dashboard/profile?tab=details&readonly=1");
  });

  it.each([
    ["an off-site referer", "https://evil.example/dashboard/profile"],
    ["a protocol-relative path", "http://localhost:3100//evil.example/dashboard"],
    ["a non-dashboard page", "http://localhost:3100/console/members"],
    ["an unparseable referer", "not a url"],
  ])("falls back to the dashboard home for %s", async (_label, referer) => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    requestHeaders.set("referer", referer);
    stubSession({ id: "a1", email: "jas@smi.local" }, ADMIN);

    const expected = referer.startsWith("https://evil.example")
      ? "NEXT_REDIRECT:/dashboard/profile?readonly=1" // only the path is ever used, never the origin
      : "NEXT_REDIRECT:/dashboard?readonly=1";
    await expect(requireMember()).rejects.toThrow(expected);
  });

  it("falls back to the dashboard home with no referer at all", async () => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    stubSession({ id: "a1", email: "jas@smi.local" }, ADMIN);

    await expect(requireMember()).rejects.toThrow("NEXT_REDIRECT:/dashboard?readonly=1");
  });

  it("lets a member through even when they carry a view-as cookie", async () => {
    cookieStore.set(VIEW_AS_COOKIE, MEMBER_ID);
    stubSession({ id: "u1", email: "m@smi.local" }, MEMBER);

    expect(await requireMember()).toMatchObject({ userId: "u1", memberId: "mem1" });
  });
});
