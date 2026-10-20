// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { changeLoginEmail } from "@/app/dashboard/actions";
import { GET } from "@/app/account/email/confirm/route";
import { sessionDb } from "@/lib/db/server";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { requireMember, currentUser, withinLimit, audit } = vi.hoisted(() => ({
  requireMember: vi.fn(async () => ({ userId: "u1", email: "old@acme.example", role: "member", memberId: "mem1", displayName: "Acme" })),
  currentUser: vi.fn(async () => ({ userId: "u1", email: "new@acme.example", role: "member", memberId: "mem1", displayName: "Acme" })),
  withinLimit: vi.fn(() => true),
  audit: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth", () => ({ requireMember, currentUser }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({ ...(await importOriginal<object>()), withinLimit }));

afterEach(() => {
  resetDbServerMocks();
  withinLimit.mockReset().mockReturnValue(true);
  audit.mockClear();
});

function authDb(over: Record<string, unknown>) {
  return {
    auth: {
      updateUser: vi.fn(async () => ({ error: null })),
      verifyOtp: vi.fn(async () => ({ error: { message: "nope" } })),
      exchangeCodeForSession: vi.fn(async () => ({ error: { message: "nope" } })),
      ...over,
    },
  } as unknown as Awaited<ReturnType<typeof sessionDb>>;
}

const form = (email: string) => {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
};

// GAPS A4.12: change the email a member logs in with.
describe("changeLoginEmail", () => {
  it("asks Supabase to change it, with the confirmation link pointed at our callback", async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ updateUser }));

    await expect(changeLoginEmail(form(" New@Acme.example "))).rejects.toThrow("NEXT_REDIRECT:/dashboard/settings/security?esent=1");

    expect(updateUser).toHaveBeenCalledWith(
      { email: "new@acme.example" },
      { emailRedirectTo: expect.stringMatching(/\/account\/email\/confirm$/) },
    );
    // the request is a security event; the new address itself isn't logged
    expect(audit).toHaveBeenCalledWith({ action: "login_email_change_requested", actorUserId: "u1", actorRole: "member", memberId: "mem1" });
  });

  it("refuses an invalid address, the current address, and a fourth request in an hour — without calling Supabase", async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ updateUser }));

    await expect(changeLoginEmail(form("not-an-email"))).rejects.toThrow("eerror=invalid");
    await expect(changeLoginEmail(form("OLD@acme.example"))).rejects.toThrow("eerror=same");
    withinLimit.mockReturnValue(false);
    await expect(changeLoginEmail(form("new@acme.example"))).rejects.toThrow("eerror=limit");

    expect(updateUser).not.toHaveBeenCalled();
  });

  it("says an address is taken without echoing Supabase's own error", async () => {
    vi.mocked(sessionDb).mockResolvedValue(authDb({ updateUser: vi.fn(async () => ({ error: { message: "A user with this email address has already been registered" } })) }));
    await expect(changeLoginEmail(form("new@acme.example"))).rejects.toThrow("NEXT_REDIRECT:/dashboard/settings/security?eerror=taken");

    vi.mocked(sessionDb).mockResolvedValue(authDb({ updateUser: vi.fn(async () => ({ error: { message: "boom" } })) }));
    await expect(changeLoginEmail(form("new@acme.example"))).rejects.toThrow("NEXT_REDIRECT:/dashboard/settings/security?eerror=failed");
  });
});

describe("GET /account/email/confirm", () => {
  const req = (qs: string) => new NextRequest(`http://localhost:3100/account/email/confirm${qs}`);

  it("verifies a token_hash as an email_change OTP, ignoring any type in the query string", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ verifyOtp }));

    const res = await GET(req("?token_hash=abc&type=recovery"));

    expect(verifyOtp).toHaveBeenCalledWith({ type: "email_change", token_hash: "abc" });
    expect(res.headers.get("location")).toContain("/dashboard/settings/security?econfirmed=1");
    expect(audit).toHaveBeenCalledWith({ action: "login_email_change_confirmed", actorUserId: "u1", actorRole: "member", memberId: "mem1" });
  });

  it("exchanges a PKCE code", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ exchangeCodeForSession }));

    const res = await GET(req("?code=xyz"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
    expect(res.headers.get("location")).toContain("econfirmed=1");
  });

  it("sends a bad, expired or missing token to login with a readable error", async () => {
    vi.mocked(sessionDb).mockResolvedValue(authDb({}));
    expect((await GET(req("?token_hash=bad"))).headers.get("location")).toContain("/login?error=email-change");
    expect((await GET(req(""))).headers.get("location")).toContain("/login?error=email-change");
  });
});
