import { afterEach, describe, expect, it, vi } from "vitest";
import { memberLogins } from "@/lib/member-logins";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

afterEach(() => {
  resetDbServerMocks();
  logError.mockReset();
});

type AuthUser = { id: string; email: string; last_sign_in_at: string | null };

function stub(userIds: string[], users: Record<string, AuthUser | null>) {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({ profiles: () => queryBuilder(dbOk(userIds.map((user_id) => ({ user_id })))) }),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => (users[id] ? dbOk({ user: users[id] }) : dbError("User not found"))),
      },
    },
  })));
}

describe("memberLogins", () => {
  it("is empty for a member with no login", async () => {
    stub([], {});

    expect(await memberLogins("mem1")).toEqual([]);
  });

  it("returns the login's email and last sign-in", async () => {
    stub(["u1"], { u1: { id: "u1", email: "acme@example.com", last_sign_in_at: "2026-10-14T08:12:00Z" } });

    expect(await memberLogins("mem1")).toEqual([{ userId: "u1", email: "acme@example.com", lastSignInAt: "2026-10-14T08:12:00Z" }]);
  });

  it("keeps every login in order, including one that has never signed in", async () => {
    stub(["u1", "u2"], {
      u1: { id: "u1", email: "first@example.com", last_sign_in_at: "2026-10-14T08:12:00Z" },
      u2: { id: "u2", email: "second@example.com", last_sign_in_at: null },
    });

    expect((await memberLogins("mem1")).map((l) => [l.email, l.lastSignInAt])).toEqual([
      ["first@example.com", "2026-10-14T08:12:00Z"],
      ["second@example.com", null],
    ]);
  });

  it("keeps a login whose Auth lookup fails, with nulls, and logs it", async () => {
    stub(["u1"], { u1: null });

    expect(await memberLogins("mem1")).toEqual([{ userId: "u1", email: null, lastSignInAt: null }]);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "member-logins:get-user" }));
  });
});
