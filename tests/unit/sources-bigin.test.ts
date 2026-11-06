import { describe, expect, it } from "vitest";
import { companyNewsPages, matchMembers, planBiginSources, type LinkedRow, type UrlRow } from "@/lib/sources/bigin";
import type { CrmCompanyRecord } from "@/lib/adapters/crm";

const company = (id: string, url: string, name = `Co ${id}`, fromWebsite = false) => ({ id, name, url, fromWebsite });
const linkedRow = (over: Partial<LinkedRow> & { id: string; url: string; bigin_account_id: string }): LinkedRow =>
  ({ bigin_account_name: `Co ${over.bigin_account_id}`, bigin_only: false, bigin_from_website: false, ...over });
const urlRow = (over: Partial<UrlRow> & { id: string; url: string }): UrlRow => ({ bigin_account_id: null, bigin_only: false, ...over });

describe("planBiginSources", () => {
  it("adds a URL that isn't on the list yet, normalised and marked as the company's", () => {
    const plan = planBiginSources({ complete: true, companies: [company("1", "www.acme.test/news#latest", "Acme Ltd")] }, [], []);
    expect(plan.insert).toEqual([{ url: "https://www.acme.test/news", domain: "acme.test", label: "Acme Ltd", accountId: "1", accountName: "Acme Ltd", fromWebsite: false }]);
    expect(plan.link).toEqual([]);
    expect(plan.unlink).toEqual([]);
  });

  it("links a URL already on the spreadsheet list instead of adding a second row", () => {
    const plan = planBiginSources(
      { complete: true, companies: [company("1", "https://acme.test/news")] },
      [],
      [urlRow({ id: "s1", url: "https://acme.test/news" })],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.link).toEqual([{ id: "s1", accountId: "1", accountName: "Co 1", reactivate: false, fromWebsite: false }]);
  });

  it("leaves an unchanged link alone, but follows a company rename", () => {
    const linked = [linkedRow({ id: "s1", url: "https://acme.test/news", bigin_account_id: "1", bigin_account_name: "Acme" })];
    expect(planBiginSources({ complete: true, companies: [company("1", "https://acme.test/news", "Acme")] }, linked, linked))
      .toEqual({ insert: [], link: [], unlink: [], skipped: [] });
    expect(planBiginSources({ complete: true, companies: [company("1", "https://acme.test/news", "Acme Group")] }, linked, linked).link)
      .toEqual([{ id: "s1", accountId: "1", accountName: "Acme Group", reactivate: false, fromWebsite: false }]);
  });

  it("a changed URL pauses the old Bigin-only row and adds the new one", () => {
    const plan = planBiginSources(
      { complete: true, companies: [company("1", "https://acme.test/blog")] },
      [linkedRow({ id: "s1", url: "https://acme.test/news", bigin_account_id: "1", bigin_only: true })],
      [],
    );
    expect(plan.unlink).toEqual([{ id: "s1", pause: true }]);
    expect(plan.insert.map((i) => i.url)).toEqual(["https://acme.test/blog"]);
  });

  it("a cleared URL pauses a Bigin-only row, but only unlinks one that is on the spreadsheet too", () => {
    const plan = planBiginSources(
      { complete: true, companies: [company("3", "https://still-here.test/news")] },
      [
        linkedRow({ id: "bigin-only", url: "https://a.test/news", bigin_account_id: "1", bigin_only: true }),
        linkedRow({ id: "spreadsheet", url: "https://b.test/news", bigin_account_id: "2", bigin_only: false }),
      ],
      [],
    );
    expect(plan.unlink).toEqual([{ id: "bigin-only", pause: true }, { id: "spreadsheet", pause: false }]);
  });

  it("a partial read never unlinks or pauses a company it didn't see — but still adds and links", () => {
    const plan = planBiginSources(
      { complete: false, companies: [company("2", "https://new.test/news")] },
      [linkedRow({ id: "s1", url: "https://a.test/news", bigin_account_id: "1", bigin_only: true })],
      [],
    );
    expect(plan.unlink).toEqual([]);
    expect(plan.insert.map((i) => i.accountId)).toEqual(["2"]);
  });

  it("a read with no URLs at all while some are linked is a renamed field, not mass clearing — nothing is paused", () => {
    const plan = planBiginSources(
      { complete: true, companies: [] },
      [linkedRow({ id: "s1", url: "https://a.test/news", bigin_account_id: "1", bigin_only: true })],
      [],
    );
    expect(plan.unlink).toEqual([]);
  });

  it("a partial read still acts on a URL it saw change", () => {
    const plan = planBiginSources(
      { complete: false, companies: [company("1", "https://a.test/blog")] },
      [linkedRow({ id: "s1", url: "https://a.test/news", bigin_account_id: "1", bigin_only: true })],
      [],
    );
    expect(plan.unlink).toEqual([{ id: "s1", pause: true }]);
  });

  it("two companies listing the same page: the first keeps it, the second is skipped", () => {
    const plan = planBiginSources(
      { complete: true, companies: [company("1", "https://shared.test/news", "First"), company("2", "shared.test/news", "Second")] },
      [],
      [],
    );
    expect(plan.insert.map((i) => i.accountId)).toEqual(["1"]);
    expect(plan.skipped).toEqual([{ accountId: "2", name: "Second", url: "https://shared.test/news", reason: "clash" }]);
  });

  it("a page still held by another company is skipped rather than taken", () => {
    const held = linkedRow({ id: "s1", url: "https://shared.test/news", bigin_account_id: "1" });
    const plan = planBiginSources(
      { complete: true, companies: [company("1", "https://shared.test/news"), company("2", "https://shared.test/news")] },
      [held],
      [held],
    );
    expect(plan.link).toEqual([]);
    expect(plan.skipped.map((s) => [s.accountId, s.reason])).toEqual([["2", "clash"]]);
  });

  it("a page one company dropped is handed to another in the same run, whatever the order, and not paused", () => {
    const held = linkedRow({ id: "s1", url: "https://shared.test/news", bigin_account_id: "1", bigin_only: true });
    // Company 2 is listed before company 1, which moved to a new page.
    const plan = planBiginSources(
      { complete: true, companies: [company("2", "https://shared.test/news"), company("1", "https://one.test/blog")] },
      [held],
      [{ id: "s1", url: "https://shared.test/news", bigin_account_id: "1", bigin_only: true }],
    );
    // The unlink is kept (it frees the company before the link runs) but never pauses a handed-over row.
    expect(plan.unlink).toEqual([{ id: "s1", pause: false }]);
    expect(plan.link).toEqual([{ id: "s1", accountId: "2", accountName: "Co 2", reactivate: false, fromWebsite: false }]);
    expect(plan.insert.map((i) => i.accountId)).toEqual(["1"]);
  });

  it("two companies swapping pages: both rows are unlinked before either is re-linked, so the unique index never trips", () => {
    const a = linkedRow({ id: "a", url: "https://one.test/news", bigin_account_id: "1", bigin_only: true });
    const b = linkedRow({ id: "b", url: "https://two.test/news", bigin_account_id: "2", bigin_only: true });
    const plan = planBiginSources(
      { complete: true, companies: [company("1", "https://two.test/news"), company("2", "https://one.test/news")] },
      [a, b],
      [a, b],
    );
    expect(plan.unlink).toEqual([{ id: "a", pause: false }, { id: "b", pause: false }]);
    expect(plan.link).toEqual([
      { id: "b", accountId: "1", accountName: "Co 1", reactivate: false, fromWebsite: false },
      { id: "a", accountId: "2", accountName: "Co 2", reactivate: false, fromWebsite: false },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("a Bigin-only page listed again after it was dropped (and paused) is switched back on", () => {
    const plan = planBiginSources(
      { complete: true, companies: [company("1", "https://acme.test/news")] },
      [],
      [urlRow({ id: "s1", url: "https://acme.test/news", bigin_only: true })],
    );
    expect(plan.link).toEqual([{ id: "s1", accountId: "1", accountName: "Co 1", reactivate: true, fromWebsite: false }]);
  });

  it("skips a URL that isn't a web address", () => {
    const plan = planBiginSources({ complete: true, companies: [company("1", "n/a")] }, [], []);
    expect(plan.insert).toEqual([]);
    expect(plan.skipped).toEqual([{ accountId: "1", name: "Co 1", url: "n/a", reason: "invalid_url" }]);
  });

  describe("Website fallback (5 Nov 2026)", () => {
    it("adds a company's Website, marked as coming from it", () => {
      const plan = planBiginSources({ complete: true, companies: [company("1", "https://acme.test", "Acme", true)] }, [], []);
      expect(plan.insert).toEqual([{ url: "https://acme.test/", domain: "acme.test", label: "Acme", accountId: "1", accountName: "Acme", fromWebsite: true }]);
    });

    it("a News Page URL beats another company's Website fallback to the same address, whatever the order", () => {
      const plan = planBiginSources(
        { complete: true, companies: [company("1", "https://group.test/", "Subsidiary", true), company("2", "https://group.test/", "Group")] },
        [],
        [],
      );
      expect(plan.insert.map((i) => [i.accountId, i.fromWebsite])).toEqual([["2", false]]);
      expect(plan.skipped).toEqual([{ accountId: "1", name: "Subsidiary", url: "https://group.test/", reason: "clash" }]);
    });

    it("filling in the News Page URL later pauses the Website row and adds the news page", () => {
      const plan = planBiginSources(
        { complete: true, companies: [company("1", "https://acme.test/news")] },
        [linkedRow({ id: "s1", url: "https://acme.test/", bigin_account_id: "1", bigin_only: true, bigin_from_website: true })],
        [],
      );
      expect(plan.unlink).toEqual([{ id: "s1", pause: true }]);
      expect(plan.insert.map((i) => [i.url, i.fromWebsite])).toEqual([["https://acme.test/news", false]]);
    });

    it("the same address switching between News Page URL and Website only updates the mark", () => {
      const linked = [linkedRow({ id: "s1", url: "https://acme.test/", bigin_account_id: "1", bigin_from_website: true })];
      const plan = planBiginSources({ complete: true, companies: [company("1", "https://acme.test/")] }, linked, linked);
      expect(plan.unlink).toEqual([]);
      expect(plan.link).toEqual([{ id: "s1", accountId: "1", accountName: "Co 1", reactivate: false, fromWebsite: false }]);
    });

    it("links a Website already on the spreadsheet list, marked, without adding a row", () => {
      const plan = planBiginSources(
        { complete: true, companies: [company("1", "acme.test", "Co 1", true)] },
        [],
        [urlRow({ id: "s1", url: "https://acme.test/" })],
      );
      expect(plan.insert).toEqual([]);
      expect(plan.link).toEqual([{ id: "s1", accountId: "1", accountName: "Co 1", reactivate: false, fromWebsite: true }]);
    });
  });
});

describe("matchMembers", () => {
  const members = [
    { id: "m-acme", website: "https://www.acme.test/" },
    { id: "m-bright", website: "brightsteel.test" },
    { id: "m-twin-1", website: "twin.test" },
    { id: "m-twin-2", website: "https://twin.test/about" },
  ];

  it("a contact linked to the company and a member decides it", () => {
    const result = matchMembers([{ accountId: "1", domain: "other.test" }], [{ bigin_company_id: "1", member_id: "m-acme" }], members);
    expect(result.get("1")).toBe("m-acme");
  });

  it("with no such contact, falls back to the one member whose website is on the domain", () => {
    const result = matchMembers([{ accountId: "1", domain: "acme.test" }, { accountId: "2", domain: "brightsteel.test" }], [], members);
    expect(result.get("1")).toBe("m-acme");
    expect(result.get("2")).toBe("m-bright");
  });

  it("two candidates either way → nobody, rather than a wrong tag", () => {
    const viaContacts = matchMembers(
      [{ accountId: "1", domain: "acme.test" }],
      [{ bigin_company_id: "1", member_id: "m-acme" }, { bigin_company_id: "1", member_id: "m-bright" }],
      members,
    );
    expect(viaContacts.get("1")).toBeNull();
    expect(matchMembers([{ accountId: "1", domain: "twin.test" }], [], members).get("1")).toBeNull();
  });

  it("ignores a contact whose member has no live page (not in the eligible list)", () => {
    const result = matchMembers([{ accountId: "1", domain: "acme.test" }], [{ bigin_company_id: "1", member_id: "m-lapsed" }], members);
    expect(result.get("1")).toBe("m-acme");
  });

  it("an admin's override wins over the contacts, the domain and ambiguity, for that company only", () => {
    const result = matchMembers(
      [{ accountId: "1", domain: "acme.test" }, { accountId: "2", domain: "twin.test" }, { accountId: "3", domain: "brightsteel.test" }],
      [{ bigin_company_id: "1", member_id: "m-acme" }],
      members,
      new Map([["1", "m-bright"], ["2", "m-picked"]]),
    );
    expect(result.get("1")).toBe("m-bright");
    expect(result.get("2")).toBe("m-picked");
    expect(result.get("3")).toBe("m-bright");
  });
});

describe("companyNewsPages (Website fallback, 5 Nov 2026)", () => {
  const rec = (id: string, newsPageUrl: string | null, website: string | null, name = `Co ${id}`): CrmCompanyRecord =>
    ({ id, name, newsPageUrl, website, fields: {} });

  it("uses the News Page URL, else the Website (marked), and leaves out companies with neither", () => {
    expect(companyNewsPages({ complete: true, companies: [
      rec("1", "https://acme.test/news", "https://acme.test", "Acme"),
      rec("2", null, "https://bright.test", "Bright"),
      rec("3", null, null, "Nothing"),
    ] })).toEqual({
      complete: true,
      companies: [
        { id: "1", name: "Acme", url: "https://acme.test/news", fromWebsite: false },
        { id: "2", name: "Bright", url: "https://bright.test", fromWebsite: true },
      ],
    });
  });

  it("withholds every Website when no company has a News Page URL — most likely a misnamed field", () => {
    expect(companyNewsPages({ complete: true, companies: [rec("1", null, "https://acme.test"), rec("2", null, "https://bright.test")] }))
      .toEqual({ complete: true, companies: [], websiteFallbackWithheld: true });
  });

  it("withholds them on a partial read too", () => {
    expect(companyNewsPages({ complete: false, companies: [rec("1", null, "https://acme.test")] }))
      .toEqual({ complete: false, companies: [], websiteFallbackWithheld: true });
  });

  it("an org with no addresses at all is just empty, not a warning", () => {
    expect(companyNewsPages({ complete: true, companies: [rec("1", null, null)] })).toEqual({ complete: true, companies: [] });
  });
});
