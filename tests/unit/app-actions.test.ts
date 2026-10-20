import { afterEach, describe, expect, it, vi } from "vitest";
import { signOut, submitDevTask } from "@/app/actions";
import { serviceDb, sessionDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";
import { revalidatePath } from "next/cache";
import { cookieStore, resetNextHeadersMocks } from "../stubs/next-headers";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { audit } = vi.hoisted(() => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/audit", () => ({ audit }));

const { allowRequest } = vi.hoisted(() => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest, MINUTE: 60_000 }));

afterEach(() => {
  resetDbServerMocks();
  allowRequest.mockReset().mockResolvedValue(true);
  vi.mocked(revalidatePath).mockClear();
  resetNextHeadersMocks();
});

function form(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  const base = { title: "Something is broken", description: "Steps to reproduce" };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) fd.set(k, v);
  return fd;
}

function stubAdminSession() {
  vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({ auth: { getUser: vi.fn(async () => dbOk({ user: { id: "u1", email: "admin@smi.local" } })) } })));
}

describe("submitDevTask", () => {
  it("rejects a caller with no session", async () => {
    vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({ auth: { getUser: vi.fn(async () => dbOk({ user: null })) } })));

    const result = await submitDevTask({ message: "" }, form());

    expect(result).toEqual({ message: "You are not signed in as an admin." });
  });

  it("rejects a logged-in member — the widget only rendering for admins proves nothing server-side", async () => {
    stubAdminSession();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk({ role: "member", member_id: "m1", display_name: null })) })));

    const result = await submitDevTask({ message: "" }, form());

    expect(result).toEqual({ message: "You are not signed in as an admin." });
  });

  it("refuses when the caller is over the per-admin rate limit", async () => {
    stubAdminSession();
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: () => queryBuilder(dbOk({ role: "admin", member_id: null, display_name: null })) })));
    allowRequest.mockResolvedValue(false);

    const result = await submitDevTask({ message: "" }, form());

    expect(result.message).toContain("Too many reports");
  });

  it("rejects a blank title without touching the database", async () => {
    stubAdminSession();
    const from = vi.fn(() => queryBuilder(dbOk({ role: "admin", member_id: null, display_name: null })));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));

    const result = await submitDevTask({ message: "" }, form({ title: "   " }));

    expect(result).toEqual({ message: "Give it a one-line title." });
    expect(from).not.toHaveBeenCalledWith("dev_tasks");
  });

  it("inserts the task stamped with the caller's identity, appends to the column, and revalidates the board", async () => {
    stubAdminSession();
    const devTasksBuilder = queryBuilder(dbOk({ sort_order: 4 }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        profiles: () => queryBuilder(dbOk({ role: "admin", member_id: null, display_name: null })),
        dev_tasks: () => devTasksBuilder,
      }),
    })));

    const result = await submitDevTask({ message: "" }, form({ title: "Broken button" }));

    expect(result).toEqual({ ok: true, message: "Logged — it'll show up on the Dev Board." });
    expect(devTasksBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({
      title: "Broken button", created_by: "u1", reporter_email: "admin@smi.local", assignee: "Luiza", sort_order: 5,
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/console/dev");
  });

  it("starts sort_order at 0 for the first task in the column", async () => {
    stubAdminSession();
    const devTasksBuilder = queryBuilder(dbOk(null));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        profiles: () => queryBuilder(dbOk({ role: "admin", member_id: null, display_name: null })),
        dev_tasks: () => devTasksBuilder,
      }),
    })));

    await submitDevTask({ message: "" }, form());

    expect(devTasksBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ sort_order: 0 }));
  });

  it("reports the database error and does not revalidate on a failed insert", async () => {
    stubAdminSession();
    const devTasksBuilder = queryBuilder(() => ({ data: null, error: { message: "constraint violated" } }));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        profiles: () => queryBuilder(dbOk({ role: "admin", member_id: null, display_name: null })),
        dev_tasks: () => devTasksBuilder,
      }),
    })));

    const result = await submitDevTask({ message: "" }, form());

    expect(result.message).toContain("constraint violated");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("signs out and forgets any view-as member, so it can't carry into the next sign-in", async () => {
    const authSignOut = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(asDb(mockDb({
      auth: { signOut: authSignOut, getUser: vi.fn(async () => dbOk({ user: { id: "u1", email: "m@acme.example" } })) },
    })));
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({ profiles: () => queryBuilder(dbOk({ role: "member", member_id: "mem1", display_name: null })) }),
    })));
    cookieStore.set(VIEW_AS_COOKIE, "11111111-1111-4111-8111-111111111111");

    await expect(signOut()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(authSignOut).toHaveBeenCalled();
    expect(cookieStore.has(VIEW_AS_COOKIE)).toBe(false);
    expect(audit).toHaveBeenCalledWith({ action: "sign_out", actorUserId: "u1", actorRole: "member", memberId: "mem1" });
  });
});
