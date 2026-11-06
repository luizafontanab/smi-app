import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCompanies } from "@/lib/crm-companies/sync";
import type { CrmCompanies, CrmCompanyRecord, CrmSync } from "@/lib/adapters/crm";
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
  local?: { bigin_id: string; name: string; website: string | null; news_page_url: string | null }[];
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
      crm_companies: () => track("crm_companies", queryBuilder<unknown>(companyCalls++ === 0 ? dbOk(local) : dbOk(overrides))),
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
      { bigin_id: "1", name: "Acme", website: "https://acme.test", news_page_url: "https://acme.test/news", last_synced_at: stamp, updated_at: stamp },
      { bigin_id: "2", name: "Co 2", website: "https://bright.test", news_page_url: null, last_synced_at: stamp, updated_at: stamp },
      { bigin_id: "3", name: "Nowhere Ltd", website: null, news_page_url: null, last_synced_at: stamp, updated_at: stamp },
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
  });
});
