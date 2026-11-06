import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCompaniesNow } from "@/app/console/crm/actions";
import type { CurrentUser } from "@/lib/auth";

/*
 * The CRM page's company actions (spec #49, seam 3): console guard, what the
 * company sync is asked to do, and the redirect + flash the admin lands on.
 */

const { requireConsole, logError, isFeatureEnabled, syncCompanies } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  logError: vi.fn(),
  isFeatureEnabled: vi.fn(async () => true),
  syncCompanies: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/lib/crm-companies/sync", () => ({ syncCompanies }));

afterEach(() => {
  requireConsole.mockClear();
  logError.mockReset();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  syncCompanies.mockReset();
});

const run = (over: Record<string, unknown> = {}) => ({ at: "2026-11-06T10:00:00Z", complete: true, read: 3, added: 1, updated: 0, sources: { added: 1 }, ...over });

describe("syncCompaniesNow", () => {
  it("is behind the console guard", async () => {
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/console"));
    await expect(syncCompaniesNow()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(syncCompanies).not.toHaveBeenCalled();
  });

  it("runs the company sync, sources included, and comes back to the Companies box", async () => {
    syncCompanies.mockResolvedValue(run());
    await expect(syncCompaniesNow()).rejects.toThrow("NEXT_REDIRECT:/console/crm?companies=synced#companies");
    expect(syncCompanies).toHaveBeenCalledWith({ deriveSources: true });
  });

  it("works with the Story crawler off, storing companies but leaving story sources alone", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    syncCompanies.mockResolvedValue(run({ sources: null }));
    await expect(syncCompaniesNow()).rejects.toThrow("NEXT_REDIRECT:/console/crm?companies=synced_no_sources#companies");
    expect(isFeatureEnabled).toHaveBeenCalledWith("story_crawler");
    expect(syncCompanies).toHaveBeenCalledWith({ deriveSources: false });
  });

  it("says so when Bigin isn't connected", async () => {
    syncCompanies.mockResolvedValue(null);
    await expect(syncCompaniesNow()).rejects.toThrow(encodeURIComponent("Bigin isn't connected"));
  });

  it("a failed sync is logged and reported, not thrown to the error page", async () => {
    syncCompanies.mockRejectedValue(new Error("db down"));
    await expect(syncCompaniesNow()).rejects.toThrow(`companies_error=${encodeURIComponent("The company sync failed part-way")}`);
    expect(logError).toHaveBeenCalled();
  });
});
