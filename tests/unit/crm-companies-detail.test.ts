import { afterEach, describe, expect, it, vi } from "vitest";
import { companyFieldRows, describeFieldRead, readOpenCompany } from "@/lib/crm-companies/detail";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
afterEach(() => resetDbServerMocks());

/*
 * The Companies box's detail view (#54): every field Bigin holds for a
 * company, under Bigin's own labels, from the JSON copy the sync stores.
 */

const labels = [
  { apiName: "Account_Name", label: "Company Name" },
  { apiName: "Owner", label: "Company Owner" },
  { apiName: "Phone", label: "Phone" },
  { apiName: "News_Page", label: "News Page URL" },
  { apiName: "Tag", label: "Tag" },
];

describe("companyFieldRows", () => {
  it("lists every field in Bigin's order under Bigin's labels, empty ones included", () => {
    const rows = companyFieldRows(
      { id: "1", Account_Name: "Acme", Owner: { name: "Jas", id: "9" }, Phone: null, News_Page: " https://acme.test/news ", Tag: [{ name: "Member" }, { name: "Laser" }] },
      labels,
    );
    expect(rows).toEqual([
      { apiName: "Account_Name", label: "Company Name", value: "Acme" },
      { apiName: "Owner", label: "Company Owner", value: "Jas" },
      { apiName: "Phone", label: "Phone", value: null },
      { apiName: "News_Page", label: "News Page URL", value: "https://acme.test/news" },
      { apiName: "Tag", label: "Tag", value: "Member, Laser" },
    ]);
  });

  it("shows fields the record has but the labels don't know, named from their API name, and skips Bigin's own bookkeeping", () => {
    const rows = companyFieldRows({ id: "1", Account_Name: "Acme", Machine_Count: 4, Email_Opt_Out: true, $approved: true, Layout: { id: "7" } }, labels.slice(0, 1));
    expect(rows).toEqual([
      { apiName: "Account_Name", label: "Company Name", value: "Acme" },
      { apiName: "Machine_Count", label: "Machine Count", value: "4" },
      { apiName: "Email_Opt_Out", label: "Email Opt Out", value: "Yes" },
      { apiName: "Layout", label: "Layout", value: '{"id":"7"}' },
    ]);
  });

  it("with no labels ever read (the token can't read the field list), names every field from its API name", () => {
    expect(companyFieldRows({ id: "1", Account_Name: "Acme", News_Page_URL: null }, null)).toEqual([
      { apiName: "Account_Name", label: "Company Name", value: "Acme" },
      { apiName: "News_Page_URL", label: "News Page URL", value: null },
    ]);
  });

  it("an empty copy (stored before the first full sync) lists the labels, all empty; no copy and no labels lists nothing", () => {
    expect(companyFieldRows({}, labels)).toEqual(labels.map((l) => ({ ...l, value: null })));
    expect(companyFieldRows(null, null)).toEqual([]);
  });
});

describe("describeFieldRead (the Companies box's quiet note)", () => {
  const base = { read: "bigin" as const, allFields: true, newsPageField: "News_Page", newsPageFieldFound: true };

  it("says nothing when every field was read and News Page URL was found, or for a run from before #54", () => {
    expect(describeFieldRead({ fieldList: base })).toBeNull();
    expect(describeFieldRead({})).toBeNull();
  });

  it("names the missing permission when the token may not read the field list", () => {
    expect(describeFieldRead({ fieldList: { ...base, read: "refused", allFields: false } })).toMatch(/Only name, Website and News Page URL are kept.*HUMAN-TODO/);
  });

  it("says which field was used when none is labelled News Page URL", () => {
    expect(describeFieldRead({ fieldList: { ...base, newsPageField: "News_Page_URL", newsPageFieldFound: false } })).toContain("News_Page_URL was used");
  });
});

describe("readOpenCompany: the News Page URL editor's part of the panel (#55)", () => {
  it("carries the Website, the News Page URL and whether an edit of it is still on its way to Bigin", async () => {
    const db = asDb(mockDb({
      from: fromByTable({
        crm_companies: () => queryBuilder(dbOk({
          id: "11111111-1111-4111-8111-111111111111", bigin_id: "1", name: "Acme", fields: {}, last_synced_at: "2026-11-06T03:00:00Z", override: null,
          website: "https://acme.test", news_page_url: "https://acme.test/press", news_page_pending_at: "2026-11-06T09:00:00Z",
        })),
        content_sources: () => queryBuilder(dbOk(null)),
        settings: () => queryBuilder(dbOk(null)),
      }),
    }));
    vi.mocked(serviceDb).mockReturnValue(db);

    expect(await readOpenCompany(db, "11111111-1111-4111-8111-111111111111")).toMatchObject({
      name: "Acme", website: "https://acme.test", newsPageUrl: "https://acme.test/press", inUse: "news_page", pushPending: true,
    });
  });
});
