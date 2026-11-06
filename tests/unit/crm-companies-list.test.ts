import { describe, expect, it } from "vitest";
import { addressInUse, parseCompanyFilter, readCompanyList } from "@/lib/crm-companies/list";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";

/* The Companies box's read model (issue #50): what each row shows. */

describe("addressInUse", () => {
  it("is the News Page URL, else the Website standing in, else none", () => {
    expect(addressInUse({ news_page_url: "https://a.test/news", website: "https://a.test" })).toBe("news_page");
    expect(addressInUse({ news_page_url: null, website: "https://a.test" })).toBe("website");
    expect(addressInUse({ news_page_url: null, website: null })).toBe("none");
  });
});

describe("parseCompanyFilter", () => {
  it("accepts the filters and falls back to all for anything else", () => {
    expect(parseCompanyFilter("using_website")).toBe("using_website");
    expect(parseCompanyFilter("no_address")).toBe("no_address");
    expect(parseCompanyFilter("deleted")).toBe("deleted");
    expect(parseCompanyFilter("deleted; drop table")).toBe("all");
    expect(parseCompanyFilter(undefined)).toBe("all");
  });
});

describe("readCompanyList", () => {
  it("lists every stored company with its linked-contact count and matched member", async () => {
    const db = asDb(mockDb({
      from: fromByTable({
        crm_companies: () => queryBuilder(dbOk([
          { id: "u1", bigin_id: "1", name: "Acme", website: "https://acme.test", news_page_url: "https://acme.test/news", last_synced_at: "2026-11-06T03:00:00Z" },
          { id: "u2", bigin_id: "2", name: "Nowhere Ltd", website: null, news_page_url: null, last_synced_at: "2026-11-06T03:00:00Z" },
        ], 2)),
        contacts: () => queryBuilder(dbOk([{ bigin_company_id: "1" }, { bigin_company_id: "1" }])),
        content_sources: () => queryBuilder(dbOk([{ bigin_account_id: "1", member: { id: "m1", name: "Acme Fabrication" } }])),
      }),
    }));

    const list = await readCompanyList(db, {});

    expect(list.count).toBe(2);
    expect(list.rows.map(({ name, inUse, contacts, member }) => ({ name, inUse, contacts, member }))).toEqual([
      { name: "Acme", inUse: "news_page", contacts: 2, member: { id: "m1", name: "Acme Fabrication" } },
      { name: "Nowhere Ltd", inUse: "none", contacts: 0, member: null },
    ]);
  });

  describe("companies deleted in Bigin (issue #52)", () => {
    const companiesDb = (rows: Record<string, unknown>[]) => {
      const companies = queryBuilder(dbOk(rows, rows.length));
      const db = asDb(mockDb({
        from: fromByTable({
          crm_companies: () => companies,
          contacts: () => queryBuilder(dbOk([])),
          content_sources: () => queryBuilder(dbOk([])),
        }),
      }));
      return { db, companies };
    };

    it("hides deleted companies by default, under every other filter too", async () => {
      for (const filter of ["all", "using_website", "no_address"] as const) {
        const { db, companies } = companiesDb([]);
        await readCompanyList(db, { filter });
        expect(companies.is).toHaveBeenCalledWith("deleted_in_bigin_at", null);
        expect(companies.not).not.toHaveBeenCalledWith("deleted_in_bigin_at", "is", null);
      }
    });

    it("the deleted filter shows only deleted companies, each with when it was found missing", async () => {
      const { db, companies } = companiesDb([
        { id: "u3", bigin_id: "3", name: "Gone Ltd", website: null, news_page_url: "https://gone.test/news", last_synced_at: "2026-11-01T03:00:00Z", deleted_in_bigin_at: "2026-11-06T03:00:00Z" },
      ]);
      const list = await readCompanyList(db, { filter: "deleted" });

      expect(companies.not).toHaveBeenCalledWith("deleted_in_bigin_at", "is", null);
      expect(companies.is).not.toHaveBeenCalledWith("deleted_in_bigin_at", null);
      expect(list.rows).toEqual([expect.objectContaining({ name: "Gone Ltd", deletedInBiginAt: "2026-11-06T03:00:00Z" })]);
    });
  });
});
