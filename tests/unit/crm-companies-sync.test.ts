import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCompanies } from "@/lib/crm-companies/sync";
import type { CompanyFieldList, CrmCompanies, CrmCompanyRecord, CrmSync } from "@/lib/adapters/crm";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

afterEach(() => resetDbServerMocks());

/*
 * The company sync through the CRM sync interface (spec #49, seam 1): a fake
 * CrmSync and the stubbed database. Asserts what lands in the tables — the
 * companies stored, the story-source writes, the run saved for the console.
 * Planner details (clashes, hand-overs, member matching) are covered as pure
 * functions in sources-bigin.test.ts.
 */

const rec = (id: string, newsPageUrl: string | null, website: string | null = null, name = `Co ${id}`): CrmCompanyRecord =>
  ({ id, name, newsPageUrl, website, fields: { id, Account_Name: name } });
const crm = (read: CrmCompanies | null) => ({ listCompanies: vi.fn(async () => read) }) as unknown as CrmSync;

type Builder = ReturnType<typeof queryBuilder>;
type Tables = "crm_companies" | "content_sources" | "contacts" | "members" | "settings";

/**
 * Table-routed fake keeping every builder it hands out. `content_sources`
 * answers by call number, as the source sync reads it several times:
 * 1 linked rows, 2 rows by URL, then writes, then the linked rows for members.
 */
function fakeDb({ local = [], sources = () => dbOk([]), members = [], contacts = [], overrides = [] }: {
  local?: { bigin_id: string; name: string; website: string | null; news_page_url: string | null; deleted_in_bigin_at?: string | null; fields?: unknown }[];
  sources?: (n: number) => DbResult;
  members?: { id: string; website: string | null }[];
  contacts?: { bigin_company_id: string; member_id: string }[];
  /** member overrides the admin has set (#53), as crm_companies answers after the first read */
  overrides?: { bigin_id: string; member_override_id: string }[];
} = {}) {
  const made: Partial<Record<Tables, Builder[]>> = {};
  let companyCalls = 0;
  let sourceCalls = 0;
  const track = (t: Tables, b: Builder) => ((made[t] ??= []).push(b), b);
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      crm_companies: () => track("crm_companies", queryBuilder<unknown>(companyCalls++ === 0 ? dbOk(local.map((r) => ({ deleted_in_bigin_at: null, ...r }))) : dbOk(overrides))),
      content_sources: () => track("content_sources", queryBuilder(sources(++sourceCalls))),
      contacts: () => track("contacts", queryBuilder(dbOk(contacts))),
      members: () => track("members", queryBuilder(dbOk(members))),
      settings: () => track("settings", queryBuilder(dbOk(null))),
    }),
  })));
  const callsOf = (t: Tables, method: string) =>
    (made[t] ?? []).flatMap((b) => (b[method] as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]));
  return { made, callsOf };
}

const NOW = () => new Date("2026-11-06T03:00:00Z");

describe("syncCompanies", () => {
  it("returns null and touches nothing when Bigin isn't connected", async () => {
    expect(await syncCompanies({ crm: crm(null) })).toBeNull();
    expect(serviceDb).not.toHaveBeenCalled();
  });

  it("stores every company Bigin returns, including those with no News Page URL and no Website", async () => {
    const t = fakeDb();
    const run = await syncCompanies({
      crm: crm({ complete: true, companies: [rec("1", "https://acme.test/news", "https://acme.test", "Acme"), rec("2", null, "https://bright.test"), rec("3", null, null, "Nowhere Ltd")] }),
      now: NOW,
    });

    const stamp = "2026-11-06T03:00:00.000Z";
    expect(t.callsOf("crm_companies", "upsert").flat()).toEqual([
      { bigin_id: "1", name: "Acme", website: "https://acme.test", news_page_url: "https://acme.test/news", deleted_in_bigin_at: null, fields: { id: "1", Account_Name: "Acme" }, last_synced_at: stamp, updated_at: stamp },
      { bigin_id: "2", name: "Co 2", website: "https://bright.test", news_page_url: null, deleted_in_bigin_at: null, fields: { id: "2", Account_Name: "Co 2" }, last_synced_at: stamp, updated_at: stamp },
      { bigin_id: "3", name: "Nowhere Ltd", website: null, news_page_url: null, deleted_in_bigin_at: null, fields: { id: "3", Account_Name: "Nowhere Ltd" }, last_synced_at: stamp, updated_at: stamp },
    ]);
    expect(run).toMatchObject({ at: stamp, complete: true, read: 3, added: 3, updated: 0 });
    const saved = t.callsOf("settings", "upsert");
    expect(saved).toContainEqual(expect.objectContaining({ key: "crm_companies_last", value: expect.objectContaining({ read: 3, added: 3 }) }));
  });

  it("rewrites only companies that changed; the rest just get their last-synced time", async () => {
    const t = fakeDb({ local: [
      { bigin_id: "1", name: "Acme", website: null, news_page_url: "https://acme.test/news" },
      { bigin_id: "2", name: "Bright", website: null, news_page_url: null },
    ] });
    const run = await syncCompanies({
      crm: crm({ complete: true, companies: [rec("1", "https://acme.test/news", null, "Acme"), rec("2", null, "https://bright.test", "Bright")] }),
      now: NOW,
    });

    expect(t.callsOf("crm_companies", "upsert").flat().map((r) => r.bigin_id)).toEqual(["2"]);
    expect(t.callsOf("crm_companies", "update")).toEqual([{ last_synced_at: "2026-11-06T03:00:00.000Z" }]);
    expect(run).toMatchObject({ read: 2, added: 0, updated: 1 });
  });

  it("derives sources unchanged: adds the new page, tags its member, and saves the sources run", async () => {
    const t = fakeDb({
      // 1 linked, 2 by URL, 3 insert, 4 linked rows for members, 5 member update
      sources: (n) => n === 3 ? dbOk([{ id: "new-1" }]) : n === 4 ? dbOk([{ id: "new-1", domain: "acme.test", bigin_account_id: "1", member_id: null }]) : dbOk([]),
      members: [{ id: "m-acme", website: "acme.test" }],
    });

    const run = await syncCompanies({ crm: crm({ complete: true, companies: [rec("1", "https://acme.test/news", null, "Acme")] }), now: NOW });

    expect(run?.sources).toEqual({ at: "2026-11-06T03:00:00.000Z", complete: true, companies: 1, fromWebsite: 0, added: 1, linked: 0, unlinked: 0, paused: 0, skipped: [], membersSet: 1 });
    expect(t.callsOf("content_sources", "insert")).toEqual([
      expect.objectContaining({ url: "https://acme.test/news", bigin_only: true, bigin_account_id: "1", active: true, label: "Acme", bigin_from_website: false }),
    ]);
    expect(t.callsOf("content_sources", "update")).toContainEqual(expect.objectContaining({ member_id: "m-acme" }));
    expect(t.callsOf("settings", "upsert")).toContainEqual(expect.objectContaining({ key: "bigin_sources_last" }));
  });

  it("marks a source added from a Website, and counts it in the run", async () => {
    const t = fakeDb();
    const run = await syncCompanies({
      crm: crm({ complete: true, companies: [rec("1", "https://acme.test/news"), rec("2", null, "https://bright.test", "Bright")] }),
      now: NOW,
    });
    expect(run?.sources).toMatchObject({ companies: 2, fromWebsite: 1 });
    expect(run?.sources).not.toHaveProperty("websiteFallbackWithheld");
    expect(t.callsOf("content_sources", "insert")).toEqual([
      expect.objectContaining({ url: "https://acme.test/news", bigin_from_website: false }),
      expect.objectContaining({ url: "https://bright.test/", bigin_from_website: true }),
    ]);
  });

  it("an unlink clears the Website mark along with the company link", async () => {
    const t = fakeDb({
      sources: (n) => n === 1
        ? dbOk([{ id: "s1", url: "https://acme.test/", bigin_account_id: "1", bigin_account_name: "Co 1", bigin_only: true, bigin_from_website: true }])
        : dbOk([]),
    });
    await syncCompanies({ crm: crm({ complete: true, companies: [rec("1", "https://acme.test/news", "https://acme.test")] }) });
    expect(t.callsOf("content_sources", "update")).toContainEqual(expect.objectContaining({ bigin_account_id: null, bigin_from_website: false, active: false }));
  });

  it("no News Page URL anywhere: stores the companies, warns, and changes no source", async () => {
    const t = fakeDb({
      sources: () => dbOk([{ id: "s1", url: "https://a.test/news", bigin_account_id: "1", bigin_account_name: "Co 1", bigin_only: true, bigin_from_website: false }]),
    });
    const run = await syncCompanies({ crm: crm({ complete: true, companies: [rec("1", null, "https://a.test"), rec("2", null, "https://b.test")] }) });

    expect(t.callsOf("crm_companies", "upsert").flat()).toHaveLength(2);
    expect(run?.sources).toMatchObject({ companies: 0, added: 0, linked: 0, unlinked: 0, paused: 0, websiteFallbackWithheld: true });
    expect(t.callsOf("content_sources", "insert")).toEqual([]);
    expect(t.callsOf("content_sources", "update").filter((u) => "bigin_account_id" in u)).toEqual([]);
  });

  it("a partial read stores what it got and changes nothing destructive", async () => {
    // Company 2's source is linked, but company 2 wasn't reached before Bigin refused a call.
    const t = fakeDb({
      local: [{ bigin_id: "2", name: "Co 2", website: null, news_page_url: "https://two.test/news" }],
      sources: (n) => n === 1
        ? dbOk([{ id: "s2", url: "https://two.test/news", bigin_account_id: "2", bigin_account_name: "Co 2", bigin_only: true, bigin_from_website: false }])
        : n === 3 ? dbOk([{ id: "new-1" }]) : dbOk([]), // 3: the insert for company 1
    });
    const run = await syncCompanies({ crm: crm({ complete: false, companies: [rec("1", "https://one.test/news")] }) });

    expect(t.callsOf("crm_companies", "upsert").flat().map((r) => r.bigin_id)).toEqual(["1"]);
    expect(t.callsOf("crm_companies", "delete")).toEqual([]);
    expect(t.callsOf("crm_companies", "update").filter((u) => "deleted_in_bigin_at" in u)).toEqual([]);
    expect(run).toMatchObject({ deleted: 0 });
    expect(t.callsOf("content_sources", "update").filter((u) => u.bigin_account_id === null || u.active === false)).toEqual([]);
    expect(run).toMatchObject({ complete: false, read: 1 });
    expect(run?.sources).toMatchObject({ complete: false, unlinked: 0, paused: 0, added: 1 });
  });

  it("with sources off, stores the companies and leaves story sources alone", async () => {
    const t = fakeDb();
    const run = await syncCompanies({ crm: crm({ complete: true, companies: [rec("1", "https://acme.test/news")] }), deriveSources: false });

    expect(t.callsOf("crm_companies", "upsert").flat()).toHaveLength(1);
    expect(t.made.content_sources).toBeUndefined();
    expect(run?.sources).toBeNull();
    expect(t.callsOf("settings", "upsert").map((s) => s.key)).toEqual(["crm_companies_last"]);
  });

  describe("companies deleted in Bigin (issue #52)", () => {
    const stamp = "2026-11-06T03:00:00.000Z";

    it("a complete read marks a missing company deleted, unlinks its source and pauses it if only Bigin added it", async () => {
      const t = fakeDb({
        local: [
          { bigin_id: "1", name: "Co 1", website: null, news_page_url: "https://one.test/news" },
          { bigin_id: "2", name: "Co 2", website: null, news_page_url: "https://two.test/news" },
        ],
        sources: (n) => n === 1
          ? dbOk([
            { id: "s1", url: "https://one.test/news", bigin_account_id: "1", bigin_account_name: "Co 1", bigin_only: true, bigin_from_website: false },
            { id: "s2", url: "https://two.test/news", bigin_account_id: "2", bigin_account_name: "Co 2", bigin_only: true, bigin_from_website: false },
          ])
          : dbOk([]),
      });
      const run = await syncCompanies({ crm: crm({ complete: true, companies: [rec("1", "https://one.test/news")] }), now: NOW });

      const marks = t.made.crm_companies!.filter((b) => (b.update as ReturnType<typeof vi.fn>).mock.calls.some((c) => "deleted_in_bigin_at" in c[0]));
      expect(marks).toHaveLength(1);
      expect(marks[0].update).toHaveBeenCalledWith({ deleted_in_bigin_at: stamp, updated_at: stamp });
      expect(marks[0].in).toHaveBeenCalledWith("bigin_id", ["2"]);
      // a company already marked keeps the time it was first found missing
      expect(marks[0].is).toHaveBeenCalledWith("deleted_in_bigin_at", null);
      expect(t.callsOf("crm_companies", "delete")).toEqual([]);
      expect(t.callsOf("content_sources", "update")).toContainEqual(expect.objectContaining({ bigin_account_id: null, active: false }));
      expect(run).toMatchObject({ complete: true, read: 1, deleted: 1, restored: 0 });
      expect(run?.sources).toMatchObject({ unlinked: 1, paused: 1 });
    });

    it("a deleted company's spreadsheet source is unlinked but keeps running", async () => {
      const t = fakeDb({
        local: [
          { bigin_id: "1", name: "Co 1", website: null, news_page_url: "https://one.test/news" },
          { bigin_id: "2", name: "Co 2", website: null, news_page_url: "https://two.test/news" },
        ],
        sources: (n) => n === 1
          ? dbOk([{ id: "s2", url: "https://two.test/news", bigin_account_id: "2", bigin_account_name: "Co 2", bigin_only: false, bigin_from_website: false }])
          : dbOk([]),
      });
      const run = await syncCompanies({ crm: crm({ complete: true, companies: [rec("1", "https://one.test/news")] }), now: NOW });

      const unlinks = t.callsOf("content_sources", "update").filter((u) => u.bigin_account_id === null);
      expect(unlinks).toHaveLength(1);
      expect(unlinks[0]).not.toHaveProperty("active");
      expect(run).toMatchObject({ deleted: 1 });
      expect(run?.sources).toMatchObject({ unlinked: 1, paused: 0 });
    });

    it("a partial read marks nothing deleted", async () => {
      const t = fakeDb({ local: [{ bigin_id: "2", name: "Co 2", website: null, news_page_url: null }] });
      const run = await syncCompanies({ crm: crm({ complete: false, companies: [rec("1", "https://one.test/news")] }), now: NOW });
      expect(t.callsOf("crm_companies", "update").filter((u) => "deleted_in_bigin_at" in u)).toEqual([]);
      expect(run).toMatchObject({ deleted: 0 });
    });

    it("a complete read with no companies at all marks nothing deleted — that is a broken read, not an empty CRM", async () => {
      const t = fakeDb({ local: [{ bigin_id: "2", name: "Co 2", website: null, news_page_url: null }] });
      const run = await syncCompanies({ crm: crm({ complete: true, companies: [] }), now: NOW });
      expect(t.callsOf("crm_companies", "update").filter((u) => "deleted_in_bigin_at" in u)).toEqual([]);
      expect(run).toMatchObject({ deleted: 0 });
    });

    it("a company that comes back is restored and its mark cleared, even with nothing else changed", async () => {
      const t = fakeDb({
        local: [{ bigin_id: "2", name: "Co 2", website: null, news_page_url: "https://two.test/news", deleted_in_bigin_at: "2026-11-01T03:00:00Z" }],
      });
      const run = await syncCompanies({ crm: crm({ complete: true, companies: [rec("2", "https://two.test/news")] }), now: NOW });

      expect(t.callsOf("crm_companies", "upsert").flat()).toEqual([
        expect.objectContaining({ bigin_id: "2", deleted_in_bigin_at: null, last_synced_at: stamp }),
      ]);
      expect(run).toMatchObject({ read: 1, added: 0, restored: 1, deleted: 0 });
      // a company that came back hasn't been edited — not counted as changed
      expect(run).toMatchObject({ updated: 0 });
    });
  });

  describe("member override (#53)", () => {
    // 1 linked, 2 by URL, 3 linked rows for members (nothing to add or link), then the member update
    const linkedAcme = [{ id: "s1", url: "https://acme.test/news", bigin_account_id: "1", bigin_account_name: "Acme", bigin_only: true, bigin_from_website: false }];
    const sourcesFor = (memberId: string | null) => (n: number) =>
      n === 1 || n === 2 ? dbOk(linkedAcme) : n === 3 ? dbOk([{ id: "s1", domain: "acme.test", bigin_account_id: "1", member_id: memberId }]) : dbOk([]);
    const acme = () => crm({ complete: true, companies: [rec("1", "https://acme.test/news", null, "Acme")] });
    const memberWrites = (t: ReturnType<typeof fakeDb>) => t.callsOf("content_sources", "update").filter((u) => "member_id" in u).map((u) => u.member_id);

    it("wins over an ambiguous automatic match", async () => {
      // two members on acme.test: the automatic match is nobody
      const t = fakeDb({
        local: [{ bigin_id: "1", name: "Acme", website: null, news_page_url: "https://acme.test/news" }],
        sources: sourcesFor(null),
        members: [{ id: "m-a", website: "acme.test" }, { id: "m-b", website: "https://acme.test" }],
        overrides: [{ bigin_id: "1", member_override_id: "m-chosen" }],
      });
      const run = await syncCompanies({ crm: acme(), now: NOW });
      expect(memberWrites(t)).toEqual(["m-chosen"]);
      expect(run?.sources).toMatchObject({ membersSet: 1 });
    });

    it("wins over a different automatic match", async () => {
      const t = fakeDb({
        local: [{ bigin_id: "1", name: "Acme", website: null, news_page_url: "https://acme.test/news" }],
        sources: sourcesFor(null),
        members: [{ id: "m-auto", website: "acme.test" }],
        contacts: [{ bigin_company_id: "1", member_id: "m-auto" }],
        overrides: [{ bigin_id: "1", member_override_id: "m-chosen" }],
      });
      await syncCompanies({ crm: acme(), now: NOW });
      expect(memberWrites(t)).toEqual(["m-chosen"]);
    });

    it("survives the sync: a source already on the chosen member is left alone, and the override is never written over", async () => {
      const t = fakeDb({
        local: [{ bigin_id: "1", name: "Acme", website: null, news_page_url: "https://acme.test/news" }],
        sources: sourcesFor("m-chosen"),
        members: [{ id: "m-auto", website: "acme.test" }],
        overrides: [{ bigin_id: "1", member_override_id: "m-chosen" }],
      });
      const run = await syncCompanies({ crm: acme(), now: NOW });
      expect(memberWrites(t)).toEqual([]);
      expect(run?.sources).toMatchObject({ membersSet: 0 });
      const companyWrites = [...t.callsOf("crm_companies", "upsert").flat(), ...t.callsOf("crm_companies", "update")];
      expect(companyWrites.some((w) => "member_override_id" in w)).toBe(false);
    });

    it("survives a company changing in Bigin: the rewrite of its row leaves the override out", async () => {
      const t = fakeDb({
        local: [{ bigin_id: "1", name: "Acme Old", website: null, news_page_url: "https://acme.test/news" }],
        sources: sourcesFor(null),
        members: [{ id: "m-auto", website: "acme.test" }],
        overrides: [{ bigin_id: "1", member_override_id: "m-chosen" }],
      });
      await syncCompanies({ crm: acme(), now: NOW });
      const written = t.callsOf("crm_companies", "upsert").flat();
      expect(written.map((w) => w.bigin_id)).toEqual(["1"]);
      expect(written[0]).not.toHaveProperty("member_override_id");
      expect(memberWrites(t)).toEqual(["m-chosen"]);
    });

    it("survives the company being deleted in Bigin (#52): the mark leaves the override alone", async () => {
      const t = fakeDb({
        local: [
          { bigin_id: "1", name: "Acme", website: null, news_page_url: "https://acme.test/news" },
          { bigin_id: "2", name: "Gone", website: null, news_page_url: null },
        ],
        sources: sourcesFor("m-chosen"),
        overrides: [{ bigin_id: "1", member_override_id: "m-chosen" }, { bigin_id: "2", member_override_id: "m-two" }],
      });
      const run = await syncCompanies({ crm: acme(), now: NOW });
      expect(run).toMatchObject({ deleted: 1 });
      const companyWrites = [...t.callsOf("crm_companies", "upsert").flat(), ...t.callsOf("crm_companies", "update")];
      expect(companyWrites.some((w) => "deleted_in_bigin_at" in w)).toBe(true);
      expect(companyWrites.some((w) => "member_override_id" in w)).toBe(false);
    });

    it("applies again when a deleted company comes back: its re-linked source is tagged with the chosen member", async () => {
      // deleted earlier, so its bigin_only source was unlinked and paused; Bigin lists it again
      const paused = { id: "s1", url: "https://acme.test/news", bigin_account_id: null, bigin_only: true };
      const t = fakeDb({
        local: [{ bigin_id: "1", name: "Acme", website: null, news_page_url: "https://acme.test/news", deleted_in_bigin_at: "2026-11-01T03:00:00Z" }],
        // 1 linked (none), 2 by URL (the paused row), 3 the re-link, 4 linked rows for members
        sources: (n) => n === 2 ? dbOk([paused]) : n === 4 ? dbOk([{ id: "s1", domain: "acme.test", bigin_account_id: "1", member_id: null }]) : dbOk([]),
        members: [{ id: "m-a", website: "acme.test" }, { id: "m-b", website: "acme.test" }],
        overrides: [{ bigin_id: "1", member_override_id: "m-chosen" }],
      });
      const run = await syncCompanies({ crm: acme(), now: NOW });
      expect(run).toMatchObject({ restored: 1 });
      const restoredRow = t.callsOf("crm_companies", "upsert").flat()[0];
      expect(restoredRow).toMatchObject({ bigin_id: "1", deleted_in_bigin_at: null });
      expect(restoredRow).not.toHaveProperty("member_override_id");
      expect(t.callsOf("content_sources", "update")).toContainEqual(expect.objectContaining({ bigin_account_id: "1", active: true }));
      expect(memberWrites(t)).toEqual(["m-chosen"]);
    });
  });
});

describe("syncCompanies — every Bigin field (#54)", () => {
  const everyField = (over: Partial<CompanyFieldList> = {}): CompanyFieldList => ({
    read: "bigin",
    fields: [{ apiName: "Account_Name", label: "Company Name" }, { apiName: "Phone", label: "Phone" }, { apiName: "Machine_Brands", label: "Machine Brands" }],
    allFields: true,
    newsPageField: "News_Page",
    newsPageFieldFound: true,
    ...over,
  });
  const full = (id: string, extra: Record<string, unknown>): CrmCompanyRecord =>
    ({ id, name: `Co ${id}`, newsPageUrl: null, website: null, fields: { id, Account_Name: `Co ${id}`, ...extra } });
  const stored = (id: string, fields: unknown) => ({ bigin_id: id, name: `Co ${id}`, website: null, news_page_url: null, fields });

  it("stores the whole record, and rewrites a company when only a custom field changed", async () => {
    const t = fakeDb({ local: [
      stored("1", { id: "1", Account_Name: "Co 1", Phone: "111", Machine_Brands: "Trumpf" }),
      // jsonb hands keys back in its own order: not a change
      stored("2", { Machine_Brands: null, Phone: "222", Account_Name: "Co 2", id: "2" }),
    ] });
    const run = await syncCompanies({
      crm: crm({ complete: true, fieldList: everyField(), companies: [
        full("1", { Phone: "111", Machine_Brands: "Trumpf, Amada" }),
        full("2", { Phone: "222", Machine_Brands: null }),
      ] }),
      now: NOW,
    });

    expect(t.callsOf("crm_companies", "upsert").flat()).toEqual([
      expect.objectContaining({ bigin_id: "1", fields: { id: "1", Account_Name: "Co 1", Phone: "111", Machine_Brands: "Trumpf, Amada" } }),
    ]);
    expect(run).toMatchObject({ updated: 1, fieldList: { read: "bigin", allFields: true, newsPageField: "News_Page", newsPageFieldFound: true } });
  });

  it("keeps Bigin's labels beside the run, for the detail view", async () => {
    const t = fakeDb();
    await syncCompanies({ crm: crm({ complete: true, fieldList: everyField(), companies: [full("1", {})] }), now: NOW });
    expect(t.callsOf("settings", "upsert")).toContainEqual({
      key: "crm_company_fields",
      value: { at: "2026-11-06T03:00:00.000Z", newsPageField: "News_Page", fields: everyField().fields },
    });
  });

  it("when the field list was refused, a stored full copy is left alone and new companies get what was read", async () => {
    const t = fakeDb({ local: [stored("1", { id: "1", Account_Name: "Co 1", Phone: "111" })] });
    const refused: CompanyFieldList = { read: "refused", fields: [], allFields: false, newsPageField: "News_Page_URL", newsPageFieldFound: false };
    const run = await syncCompanies({
      crm: crm({ complete: true, fieldList: refused, companies: [{ ...full("1", {}), name: "Renamed" }, full("2", {})] }),
      now: NOW,
    });

    const written = t.callsOf("crm_companies", "upsert").flat();
    expect(written.find((r) => r.bigin_id === "1")).not.toHaveProperty("fields");
    expect(written.find((r) => r.bigin_id === "1")).toMatchObject({ name: "Renamed" });
    expect(written.find((r) => r.bigin_id === "2")).toMatchObject({ fields: { id: "2", Account_Name: "Co 2" } });
    // two upserts, so PostgREST never fills a missing `fields` with its default
    expect(t.callsOf("crm_companies", "upsert").every((batch: Record<string, unknown>[]) => new Set(batch.map((r) => "fields" in r)).size === 1)).toBe(true);
    expect(t.callsOf("settings", "upsert").map((x) => x.key)).not.toContain("crm_company_fields");
    expect(run?.fieldList).toMatchObject({ read: "refused" });
  });
});
