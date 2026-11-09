import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptImportedNewsPage, saveCompanyNewsPage, setCompanyMember } from "@/app/console/crm/actions";
import type { CurrentUser } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/*
 * The Companies box's list state through its company forms (spec #49 review):
 * an admin who narrowed, searched, filtered or paged the list and then saves
 * something in a company's panel lands back on that same list, not the full
 * one. Only the box's own four parameters ride along, and only valid values.
 * Also the refusal for a company deleted in Bigin. (Kept apart from
 * console-actions-crm-companies.test.ts, which is left as it was reviewed.)
 */

const { requireConsole, logError, isFeatureEnabled, refreshMembers, setCompanyNewsPage, adoptImportedSource } = vi.hoisted(() => ({
  requireConsole: vi.fn(async (): Promise<CurrentUser> => ({
    userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas",
  })),
  logError: vi.fn(),
  isFeatureEnabled: vi.fn(async () => true),
  refreshMembers: vi.fn(async () => 1),
  setCompanyNewsPage: vi.fn(async (): Promise<"pushed" | "pending" | "not_allowed" | "not_found" | "deleted"> => "pushed"),
  adoptImportedSource: vi.fn(async (): Promise<{ outcome: "pushed" | "pending" | "not_allowed" | "not_found" | "deleted" | "not_covering"; linked: boolean }> => ({ outcome: "pushed", linked: true })),
}));
vi.mock("@/lib/crm-companies/news-page", () => ({ setCompanyNewsPage, checkCompanyWriteAccess: vi.fn() }));
vi.mock("@/lib/crm-companies/covered", () => ({ adoptImportedSource }));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled }));
vi.mock("@/lib/crm-companies/sync", () => ({ syncCompanies: vi.fn() }));
vi.mock("@/lib/sources/bigin", () => ({ refreshMembers }));
vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => {
  logError.mockReset();
  setCompanyNewsPage.mockReset().mockResolvedValue("pushed");
  adoptImportedSource.mockReset().mockResolvedValue({ outcome: "pushed", linked: true });
  refreshMembers.mockReset().mockResolvedValue(1);
  resetDbServerMocks();
});

const COMPANY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const SOURCE = "44444444-4444-4444-8444-444444444444";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const LIST = { cid: "9100000000001", cq: "acme ltd", cfilter: "covered", cpage: "2" };
const KEPT = "cid=9100000000001&cq=acme+ltd&cfilter=covered&cpage=2&";
const at = (list: string, query: string) => `NEXT_REDIRECT:/console/crm?${list}company=${COMPANY}&${query}#companies`;
/** The start of a redirect, for an error message checked only in part. */
const startsAt = (list: string, query: string) => `NEXT_REDIRECT:/console/crm?${list}company=${COMPANY}&${query}`;

function memberDb() {
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({ crm_companies: () => queryBuilder(dbOk([{ id: COMPANY }])), members: () => queryBuilder(dbOk({ id: MEMBER })) }),
  })));
}

describe("the Companies box's list state survives a company form", () => {
  it("saving a News Page URL comes back to the same list", async () => {
    await expect(saveCompanyNewsPage(form({ company: COMPANY, news_page_url: "https://acme.test/press", ...LIST })))
      .rejects.toThrow(at(KEPT, "companies=news_page_saved"));
  });

  it("saving and clearing a member come back to the same list", async () => {
    memberDb();
    await expect(setCompanyMember(form({ company: COMPANY, member_id: MEMBER, ...LIST })))
      .rejects.toThrow(at(KEPT, "companies=member_set"));
    await expect(setCompanyMember(form({ company: COMPANY, member_id: "", ...LIST })))
      .rejects.toThrow(at(KEPT, "companies=member_cleared"));
  });

  it("Use as News Page URL comes back to the same list", async () => {
    await expect(adoptImportedNewsPage(form({ company: COMPANY, source: SOURCE, ...LIST })))
      .rejects.toThrow(at(KEPT, "companies=imported_used"));
  });

  it("a refusal comes back to the same list too", async () => {
    setCompanyNewsPage.mockResolvedValue("not_allowed");
    await expect(saveCompanyNewsPage(form({ company: COMPANY, news_page_url: "https://acme.test/press", ...LIST })))
      .rejects.toThrow(startsAt(KEPT, `companies_error=${encodeURIComponent("Bigin doesn't let the app change companies yet")}`));
  });

  it("carries only the box's own parameters, and only valid values", async () => {
    const junk = { cid: "91 OR 1=1", cq: "x".repeat(500), cfilter: "everything", cpage: "-3", contact: COMPANY, companies: "member_set", next: "https://evil.test" };
    await expect(saveCompanyNewsPage(form({ company: COMPANY, news_page_url: "https://acme.test/press", ...junk })))
      .rejects.toThrow(at("", "companies=news_page_saved"));
  });

  it("leaves out the defaults: the All filter and the first page", async () => {
    await expect(saveCompanyNewsPage(form({ company: COMPANY, news_page_url: "", cq: "acme", cfilter: "all", cpage: "1" })))
      .rejects.toThrow(at("cq=acme&", "companies=news_page_saved"));
  });
});

describe("a company deleted in Bigin (#52)", () => {
  it("its News Page URL is refused with a reason, not saved", async () => {
    setCompanyNewsPage.mockResolvedValue("deleted");
    await expect(saveCompanyNewsPage(form({ company: COMPANY, news_page_url: "https://acme.test/press" })))
      .rejects.toThrow(at("", `companies_error=${encodeURIComponent("That company was deleted in Bigin, so its News Page URL can't be changed. Restore it in Bigin and sync companies to edit it again.")}`));
  });

  it("Use as News Page URL is refused the same way", async () => {
    adoptImportedSource.mockResolvedValue({ outcome: "deleted", linked: false });
    await expect(adoptImportedNewsPage(form({ company: COMPANY, source: SOURCE })))
      .rejects.toThrow(startsAt("", `companies_error=${encodeURIComponent("That company was deleted in Bigin")}`));
  });
});
