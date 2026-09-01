import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIp } from "@/lib/adapters/company-resolver";

afterEach(() => {
  vi.unstubAllEnvs();
});

// GAPS C2: resolveIp() used to return a hashed-IP placeholder region
// regardless of environment, which meant paying members saw an invented UK
// region on /dashboard/stats labelled as real data. Both fields are null
// until GeoLite2/a company vendor is actually wired (B2.1/B2.2) — no stub.
describe("resolveIp", () => {
  it("never resolves a company — that resolver isn't wired up yet", async () => {
    expect((await resolveIp("local")).company).toBeNull();
    expect((await resolveIp("203.0.113.5")).company).toBeNull();
  });

  it("never resolves a region either, until GeoLite2 is wired", async () => {
    for (const ip of ["local", "127.0.0.1", "::1", "203.0.113.5"]) {
      expect((await resolveIp(ip)).region).toBeNull();
    }
  });

  it("is deterministic for the same ip", async () => {
    const a = await resolveIp("203.0.113.5");
    const b = await resolveIp("203.0.113.5");
    expect(a).toEqual(b);
  });

  it("still returns null when COMPANY_RESOLVER=vendor — not wired up yet", async () => {
    vi.stubEnv("COMPANY_RESOLVER", "vendor");
    const result = await resolveIp("203.0.113.5");
    expect(result.company).toBeNull();
    expect(result.region).toBeNull();
  });
});
