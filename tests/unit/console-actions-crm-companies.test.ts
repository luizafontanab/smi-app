import { afterEach, describe, expect, it, vi } from "vitest";
import { saveCompanyNewsPage, syncCompaniesNow } from "@/app/console/crm/actions";
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
const { setCompanyNewsPage, checkCompanyWriteAccess } = vi.hoisted(() => ({
  setCompanyNewsPage: vi.fn(async (): Promise<"pushed" | "pending" | "not_allowed" | "not_found"> => "pushed"),
  checkCompanyWriteAccess: vi.fn(async () => ({ allowed: true, at: "2026-11-06T10:00:00Z" })),
}));
vi.mock("@/lib/crm-companies/news-page", () => ({ setCompanyNewsPage, checkCompanyWriteAccess }));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/lib/crm-companies/sync", () => ({ syncCompanies }));

afterEach(() => {
  requireConsole.mockClear();
  logError.mockReset();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  syncCompanies.mockReset();
  setCompanyNewsPage.mockReset().mockResolvedValue("pushed");
  checkCompanyWriteAccess.mockClear();
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

  it("re-checks whether the token may write companies, so the editor opens once the scope is granted", async () => {
    syncCompanies.mockResolvedValue(run());
    await expect(syncCompaniesNow()).rejects.toThrow("NEXT_REDIRECT");
    expect(checkCompanyWriteAccess).toHaveBeenCalled();
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

describe("saveCompanyNewsPage (issue #55)", () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const back = (query: string) => `NEXT_REDIRECT:/console/crm?company=91&${query}#companies`;

  it("is behind the console guard", async () => {
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/console"));
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "https://acme.test/press" }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(setCompanyNewsPage).not.toHaveBeenCalled();
  });

  it("saves the address and pushes it, landing back on the company with a flash", async () => {
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: " https://acme.test/press " }))).rejects.toThrow(back("companies=news_page_saved"));
    expect(setCompanyNewsPage).toHaveBeenCalledWith("91", "https://acme.test/press", { deriveSources: true });
  });

  it("says when the address is saved but still on its way to Bigin", async () => {
    setCompanyNewsPage.mockResolvedValue("pending");
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "https://acme.test/press" }))).rejects.toThrow(back("companies=news_page_pending"));
  });

  it("an empty field clears the address, so the Website stands in", async () => {
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "" }))).rejects.toThrow(back("companies=news_page_saved"));
    expect(setCompanyNewsPage).toHaveBeenCalledWith("91", null, { deriveSources: true });
  });

  it("an address missing its https:// is completed, not refused", async () => {
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "acme.test/press" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(setCompanyNewsPage).toHaveBeenCalledWith("91", "https://acme.test/press", { deriveSources: true });
  });

  it("refuses something that isn't a web address, saving nothing", async () => {
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "not an address" }))).rejects.toThrow("companies_error=");
    expect(setCompanyNewsPage).not.toHaveBeenCalled();
  });

  it("with the Story crawler off, saves and pushes but leaves story sources alone", async () => {
    isFeatureEnabled.mockResolvedValue(false);
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "https://acme.test/press" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(setCompanyNewsPage).toHaveBeenCalledWith("91", "https://acme.test/press", { deriveSources: false });
  });

  it("is refused cleanly while the Bigin token can't write companies", async () => {
    setCompanyNewsPage.mockResolvedValue("not_allowed");
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "https://acme.test/press" })))
      .rejects.toThrow(back(`companies_error=${encodeURIComponent("Bigin doesn't let the app change companies yet, so edit in Bigin for now.")}`));
  });

  it("a failed save is logged and reported, not thrown to the error page", async () => {
    setCompanyNewsPage.mockRejectedValue(new Error("db down"));
    await expect(saveCompanyNewsPage(form({ company: "91", news_page_url: "https://acme.test/press" }))).rejects.toThrow("companies_error=");
    expect(logError).toHaveBeenCalled();
  });
});
