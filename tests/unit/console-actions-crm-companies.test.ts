import { afterEach, describe, expect, it, vi } from "vitest";
import { setCompanyMember, syncCompaniesNow } from "@/app/console/crm/actions";
import type { CurrentUser } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/*
 * The CRM page's company actions (spec #49, seam 3): console guard, what the
 * company sync is asked to do, and the redirect + flash the admin lands on.
 */

const { requireConsole, logError, isFeatureEnabled, syncCompanies, refreshMembers } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  logError: vi.fn(),
  isFeatureEnabled: vi.fn(async () => true),
  syncCompanies: vi.fn(),
  refreshMembers: vi.fn(async () => 1),
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/lib/crm-companies/sync", () => ({ syncCompanies }));
vi.mock("@/lib/sources/bigin", () => ({ refreshMembers }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  requireConsole.mockClear();
  logError.mockReset();
  isFeatureEnabled.mockReset().mockResolvedValue(true);
  syncCompanies.mockReset();
  refreshMembers.mockReset().mockResolvedValue(1);
  resetDbServerMocks();
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

describe("setCompanyMember (#53)", () => {
  const COMPANY = "11111111-1111-4111-8111-111111111111";
  const MEMBER = "22222222-2222-4222-8222-222222222222";
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  /** crm_companies answers the override write; members the "is this member available" check. */
  function db({ company = dbOk([{ id: COMPANY }]), member = dbOk({ id: MEMBER }) }: { company?: DbResult; member?: DbResult } = {}) {
    const companies = queryBuilder(company);
    const members = queryBuilder(member);
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from: fromByTable({ crm_companies: () => companies, members: () => members }) })));
    return { companies };
  }

  it("is behind the console guard", async () => {
    const t = db();
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/console"));
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER }))).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(t.companies.update).not.toHaveBeenCalled();
    expect(refreshMembers).not.toHaveBeenCalled();
  });

  it("sets the override, re-tags the company's sources straight away, and comes back to the company", async () => {
    const t = db();
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER })))
      .rejects.toThrow(`NEXT_REDIRECT:/console/crm?company=${COMPANY}&companies=member_set#companies`);
    expect(t.companies.update).toHaveBeenCalledWith(expect.objectContaining({ member_override_id: MEMBER }));
    expect(t.companies.eq).toHaveBeenCalledWith("id", COMPANY);
    expect(refreshMembers).toHaveBeenCalled();
  });

  it("clearing goes back to the automatic match, straight away", async () => {
    const t = db();
    await expect(setCompanyMember(form({ company: COMPANY, member_id: "" })))
      .rejects.toThrow(`NEXT_REDIRECT:/console/crm?company=${COMPANY}&companies=member_cleared#companies`);
    expect(t.companies.update).toHaveBeenCalledWith(expect.objectContaining({ member_override_id: null }));
    expect(refreshMembers).toHaveBeenCalled();
  });

  it("refuses a member that isn't available (archived or gone)", async () => {
    const t = db({ member: dbOk(null) });
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER }))).rejects.toThrow("companies_error=");
    expect(t.companies.update).not.toHaveBeenCalled();
  });

  it("refuses a malformed company or member id without touching the database", async () => {
    db();
    await expect(setCompanyMember(form({ company: "nope", member_id: MEMBER }))).rejects.toThrow("companies_error=");
    await expect(setCompanyMember(form({ company: COMPANY, member_id: "x; drop" }))).rejects.toThrow("companies_error=");
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("a company that isn't stored is reported, and nothing is re-tagged", async () => {
    db({ company: dbOk([]) });
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER }))).rejects.toThrow("companies_error=");
    expect(refreshMembers).not.toHaveBeenCalled();
  });

  it("a failed write is logged and reported", async () => {
    db({ company: dbError("db down") });
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER }))).rejects.toThrow("companies_error=");
    expect(logError).toHaveBeenCalled();
    expect(refreshMembers).not.toHaveBeenCalled();
  });

  it("if re-tagging fails, the choice is still saved and the admin is told the next sync applies it", async () => {
    db();
    refreshMembers.mockRejectedValue(new Error("db down"));
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER }))).rejects.toThrow(encodeURIComponent("next company sync"));
    expect(logError).toHaveBeenCalled();
  });
});
