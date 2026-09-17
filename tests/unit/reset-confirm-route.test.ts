// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/reset/confirm/route";
import { sessionDb } from "@/lib/db/server";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
});

function authDb(over: Record<string, unknown>) {
  return {
    auth: {
      verifyOtp: vi.fn(async () => ({ error: { message: "nope" } })),
      exchangeCodeForSession: vi.fn(async () => ({ error: { message: "nope" } })),
      ...over,
    },
  } as unknown as Awaited<ReturnType<typeof sessionDb>>;
}

const req = (qs: string) => new NextRequest(`http://localhost:3100/reset/confirm${qs}`);

describe("GET /reset/confirm", () => {
  it("verifies a token_hash as a recovery OTP and lands on the password form", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ verifyOtp }));

    const res = await GET(req("?token_hash=abc123"));

    // type is hardcoded — the route must not be repurposable for signup or
    // email-change OTPs via a crafted query string.
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(res.headers.get("location")).toContain("/reset/new");
  });

  it("ignores a query-string type override", async () => {
    const verifyOtp = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ verifyOtp }));

    await GET(req("?token_hash=abc123&type=email_change"));
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
  });

  it("exchanges a PKCE code when no token_hash is present", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ exchangeCodeForSession }));

    const res = await GET(req("?code=pkce-code"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(res.headers.get("location")).toContain("/reset/new");
  });

  it("bounces to login with the reset error when the token is bad", async () => {
    vi.mocked(sessionDb).mockResolvedValue(authDb({}));

    const res = await GET(req("?token_hash=expired"));
    expect(res.headers.get("location")).toContain("/login?error=reset");
  });

  it("bounces to login when the PKCE exchange is refused", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({ error: { message: "expired" } }));
    vi.mocked(sessionDb).mockResolvedValue(authDb({ exchangeCodeForSession }));

    const res = await GET(req("?code=stale-code"));

    expect(res.headers.get("location")).toContain("/login?error=reset");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("stale-code");
  });

  it("bounces to login when no token is supplied at all", async () => {
    vi.mocked(sessionDb).mockResolvedValue(authDb({}));

    const res = await GET(req(""));
    expect(res.headers.get("location")).toContain("/login?error=reset");
  });
});
