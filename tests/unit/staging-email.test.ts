import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmails, allowedRecipients, resetAdminEmailCache } from "@/lib/staging-email";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError }));

/** Admins' profiles, and the login email each user id has in Supabase Auth. */
function db(profiles: ReturnType<typeof dbOk> | ReturnType<typeof dbError>, emails: Record<string, string> = {}) {
  const getUserById = vi.fn(async (id: string) => dbOk({ user: emails[id] ? { email: emails[id] } : null }));
  const client = { ...mockDb({ from: () => queryBuilder(profiles) }), auth: { admin: { getUserById } } };
  vi.mocked(serviceDb).mockReturnValue(asDb(client as unknown as ReturnType<typeof mockDb>));
  return getUserById;
}

afterEach(() => {
  resetDbServerMocks();
  resetAdminEmailCache();
  logError.mockReset();
  vi.unstubAllEnvs();
});

describe("adminEmails", () => {
  it("is every admin's login email, lower-cased, plus the ADMIN_EMAIL inbox", async () => {
    vi.stubEnv("ADMIN_EMAIL", " Inbox@SMI.test ");
    db(dbOk([{ user_id: "u1" }, { user_id: "u2" }]), { u1: "Jas@SMI.test", u2: "luiza@example.test" });

    expect(await adminEmails()).toEqual(new Set(["inbox@smi.test", "jas@smi.test", "luiza@example.test"]));
  });

  it("asks only for admins' profiles", async () => {
    const profiles = queryBuilder(dbOk([]));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => profiles })));

    await adminEmails();

    expect((profiles.eq as ReturnType<typeof vi.fn>).mock.calls).toEqual([["role", "admin"]]);
  });

  it("reads the list once per few minutes, not on every email", async () => {
    const getUserById = db(dbOk([{ user_id: "u1" }]), { u1: "jas@smi.test" });

    await adminEmails(1_000);
    await adminEmails(2_000);
    expect(getUserById).toHaveBeenCalledTimes(1);

    await adminEmails(1_000 + 5 * 60 * 1000);
    expect(getUserById).toHaveBeenCalledTimes(2);
  });
});

describe("allowedRecipients", () => {
  it("keeps admins from a list, in any case and with a display name", async () => {
    db(dbOk([{ user_id: "u1" }]), { u1: "jas@smi.test" });

    expect(await allowedRecipients("member@example.test, Jas <JAS@smi.test>")).toEqual(["Jas <JAS@smi.test>"]);
  });

  it("allows nobody when the admin list can't be read, and logs it", async () => {
    db(dbError("boom"));

    expect(await allowedRecipients("jas@smi.test")).toEqual([]);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ area: "email:staging_admins" }));
  });
});
