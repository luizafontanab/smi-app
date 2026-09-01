import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdmin, requireConsole, requireMember, type CurrentUser } from "@/lib/auth";
import { serviceDb, sessionDb } from "@/lib/db/server";
import { asDb, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
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
