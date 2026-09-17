// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * The outer route gate (Next 16 middleware replacement) — previously at 0%
 * coverage despite being the first line of defence for /console and
 * /dashboard. Role checks happen again inside layouts/actions; what belongs
 * here is the prefix gating and the anonymous fast path.
 */
const { getUser, getSession } = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: null } })),
  getSession: vi.fn(async () => ({ data: { session: null } })),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser, getSession } })),
}));

afterEach(() => vi.clearAllMocks());

const req = (path: string, withSbCookie = false) => {
  const r = new NextRequest(`http://localhost:3100${path}`);
  if (withSbCookie) r.cookies.set("sb-local-auth-token", "t");
  return r;
};

describe("proxy route gate", () => {
  it("sends an anonymous visitor to /login with the destination in ?next=", async () => {
    const res = await proxy(req("/console/members"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/console/members");
    expect(getUser).not.toHaveBeenCalled(); // no cookie → no auth round-trip
  });

  it("gates /dashboard the same way", async () => {
    const res = await proxy(req("/dashboard/billing"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("lets anonymous public traffic through without touching auth", async () => {
    const res = await proxy(req("/member"));
    expect(res.headers.get("location")).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("verifies a cookie-holding visitor with getUser() on gated routes and bounces a stale session", async () => {
    const res = await proxy(req("/console", true));
    expect(getUser).toHaveBeenCalled();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("lets a verified user into gated routes", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "u1" } as never } });
    const res = await proxy(req("/console", true));
    expect(res.headers.get("location")).toBeNull();
  });

  it("only refreshes (getSession) on public routes for cookie holders — never the per-view getUser round-trip", async () => {
    const res = await proxy(req("/news/some-story", true));
    expect(res.headers.get("location")).toBeNull();
    expect(getSession).toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });
});
