import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkCompanyWriteAccess, pushCompanyNewsPage, retryPendingCompanyPushes, setCompanyNewsPage,
} from "@/lib/crm-companies/news-page";
import { BiginApiError, type CrmSync } from "@/lib/adapters/crm";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockClear();
  vi.restoreAllMocks();
});

/*
 * A News Page URL edit written through to Bigin (issue #55, spec #49, ADR
 * 0002), through the CRM sync interface: a fake CrmSync and the stubbed
 * database. Asserts what an admin or Bigin would observe — the row saved
 * and marked pending, the write Bigin receives, the retry queued, the story
 * source that follows the new address.
 */

const NOW = () => new Date("2026-11-06T10:00:00Z");
const STAMP = "2026-11-06T10:00:00.000Z";

function fakeCrm(over: Partial<Record<"updateCompanyNewsPage" | "canWriteCompanies", ReturnType<typeof vi.fn>>> = {}) {
  return {
    live: true,
    updateCompanyNewsPage: over.updateCompanyNewsPage ?? vi.fn(async () => {}),
    canWriteCompanies: over.canWriteCompanies ?? vi.fn(async () => true),
  } as unknown as CrmSync & { updateCompanyNewsPage: ReturnType<typeof vi.fn>; canWriteCompanies: ReturnType<typeof vi.fn> };
}

type Builder = ReturnType<typeof queryBuilder>;
type T = "crm_companies" | "settings" | "content_sources" | "contacts" | "members";

/**
 * `company` answers every crm_companies call; `access` is the stored write
 * check and `fieldLabels` the field list #54 stores (settings, by key);
 * `sources` answers content_sources by call number.
 */
function fakeDb({ company = null, access = { allowed: true, at: "2026-11-05T00:00:00Z" }, fieldLabels = null, sources = () => dbOk([]), pending = [] }: {
  company?: Record<string, unknown> | null;
  access?: { allowed: boolean; at: string } | null;
  fieldLabels?: { newsPageField: string } | null;
  sources?: (n: number) => DbResult;
  pending?: { bigin_id: string }[];
} = {}) {
  const made: Partial<Record<T, Builder[]>> = {};
  let sourceCalls = 0;
  const track = (t: T, b: Builder) => ((made[t] ??= []).push(b), b);
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      crm_companies: () => {
        const b = queryBuilder(dbOk(company));
        // the retry sweep's list read ends in .limit(); every other read is one row
        b.limit = vi.fn(() => queryBuilder(dbOk(pending)));
        return track("crm_companies", b);
      },
      settings: () => {
        const b: Builder = queryBuilder(() => {
          const key = (b.eq as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === "key")?.[1];
          const value = key === "crm_company_fields" ? fieldLabels : key === "crm_companies_write" ? access : null;
          return dbOk(value ? { value } : null);
        });
        return track("settings", b);
      },
      content_sources: () => track("content_sources", queryBuilder(sources(++sourceCalls))),
      contacts: () => track("contacts", queryBuilder(dbOk([]))),
      members: () => track("members", queryBuilder(dbOk([]))),
    }),
  })));
  const calls = (t: T, method: string) =>
    (made[t] ?? []).flatMap((b) => (b[method] as ReturnType<typeof vi.fn>).mock.calls);
  return { made, calls, first: (t: T, method: string) => calls(t, method).map((c) => c[0]) };
}

const ROW = "11111111-1111-4111-8111-111111111111";
const ACME = { bigin_id: "91", name: "Acme", website: "https://acme.test", news_page_url: "https://acme.test/press", news_page_pending_at: STAMP };

describe("setCompanyNewsPage", () => {
  it("saves the address, marks it pending, pushes it to Bigin, and clears the mark once Bigin accepts", async () => {
    const t = fakeDb({ company: ACME });
    const crm = fakeCrm();

    expect(await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm, now: NOW, deriveSources: false })).toBe("pushed");

    expect(t.first("crm_companies", "update")).toEqual([
      { news_page_url: "https://acme.test/press", news_page_pending_at: STAMP, updated_at: STAMP },
      { news_page_pending_at: null },
    ]);
    expect(crm.updateCompanyNewsPage).toHaveBeenCalledWith("91", "https://acme.test/press", "News_Page_URL");
    // only the edit that was pushed is cleared — a newer one saved meanwhile stays pending
    expect(t.calls("crm_companies", "eq")).toContainEqual(["news_page_pending_at", STAMP]);
  });

  it("writes to the field Bigin's field list named News Page URL, once the sync has read it (#54)", async () => {
    fakeDb({ company: ACME, fieldLabels: { newsPageField: "News_Page" } });
    const crm = fakeCrm();
    await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm, now: NOW, deriveSources: false });
    expect(crm.updateCompanyNewsPage).toHaveBeenCalledWith("91", "https://acme.test/press", "News_Page");
  });

  it("the CRM editor names the company by its row id", async () => {
    const t = fakeDb({ company: ACME });
    await setCompanyNewsPage({ id: "11111111-1111-4111-8111-111111111111" }, "https://acme.test/press", { crm: fakeCrm(), now: NOW, deriveSources: false });
    expect(t.calls("crm_companies", "eq")[0]).toEqual(["id", "11111111-1111-4111-8111-111111111111"]);
  });

  it("a blank address is saved as no address, and Bigin's field is cleared", async () => {
    const t = fakeDb({ company: { ...ACME, news_page_url: null } });
    const crm = fakeCrm();
    await setCompanyNewsPage({ id: ROW }, "   ", { crm, now: NOW, deriveSources: false });
    expect(t.first("crm_companies", "update")[0]).toMatchObject({ news_page_url: null });
    expect(crm.updateCompanyNewsPage).toHaveBeenCalledWith("91", null, "News_Page_URL");
  });

  it("a failed push stays pending and queues a retry on the CRM push path", async () => {
    const t = fakeDb({ company: ACME });
    const crm = fakeCrm({ updateCompanyNewsPage: vi.fn(async () => { throw new BiginApiError("Bigin down", 503, null); }) });

    expect(await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm, now: NOW, deriveSources: false })).toBe("pending");

    expect(t.first("crm_companies", "update")).toEqual([{ news_page_url: "https://acme.test/press", news_page_pending_at: STAMP, updated_at: STAMP }]);
    expect(enqueue).toHaveBeenCalledWith("crm_push", { company_id: "91" }, expect.any(Date));
  });

  it("a scope refusal also turns editing off until the token can write companies", async () => {
    const t = fakeDb({ company: ACME });
    const refusal = new BiginApiError("scope", 401, { code: "OAUTH_SCOPE_MISMATCH" });
    const crm = fakeCrm({ updateCompanyNewsPage: vi.fn(async () => { throw refusal; }) });

    expect(await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm, now: NOW, deriveSources: false })).toBe("pending");

    expect(t.first("settings", "upsert")).toContainEqual({ key: "crm_companies_write", value: { allowed: false, at: STAMP } });
    expect(enqueue).toHaveBeenCalledWith("crm_push", { company_id: "91" }, expect.any(Date));
  });

  it("is refused, saving nothing, while the token isn't known to write companies", async () => {
    for (const access of [null, { allowed: false, at: "2026-11-05T00:00:00Z" }]) {
      const t = fakeDb({ company: ACME, access });
      const crm = fakeCrm();
      expect(await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm, now: NOW })).toBe("not_allowed");
      expect(t.first("crm_companies", "update")).toEqual([]);
      expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
    }
  });

  it("is refused when Bigin isn't connected", async () => {
    fakeDb({ company: ACME });
    expect(await setCompanyNewsPage({ id: ROW }, "https://x.test", { crm: { ...fakeCrm(), live: false } as CrmSync, now: NOW })).toBe("not_allowed");
  });

  it("a company deleted in Bigin is refused: nothing saved, no source moved, nothing pushed", async () => {
    const t = fakeDb({ company: { ...ACME, deleted_in_bigin_at: "2026-11-05T03:00:00Z" } });
    const crm = fakeCrm();
    expect(await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm, now: NOW })).toBe("deleted");
    expect(t.first("crm_companies", "update")).toEqual([]);
    expect(t.made.content_sources).toBeUndefined();
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("an unknown company saves nothing and pushes nothing", async () => {
    fakeDb({ company: null });
    const crm = fakeCrm();
    expect(await setCompanyNewsPage({ id: ROW }, "https://x.test", { crm, now: NOW })).toBe("not_found");
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
  });

  describe("the company's story source follows the new address straight away", () => {
    it("moves the company's source to the new address", async () => {
      const t = fakeDb({
        company: ACME,
        // 1 linked rows, 2 rows by URL, 3 the insert, 4 linked rows for members
        sources: (n) => n === 1
          ? dbOk([{ id: "s-old", url: "https://acme.test/news", bigin_account_id: "91", bigin_account_name: "Acme", bigin_only: true, bigin_from_website: false }])
          : n === 3 ? dbOk([{ id: "s-new" }]) : dbOk([]),
      });
      await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm: fakeCrm(), now: NOW });

      expect(t.first("content_sources", "update")).toContainEqual(expect.objectContaining({ bigin_account_id: null, active: false }));
      expect(t.first("content_sources", "insert")).toEqual([expect.objectContaining({ url: "https://acme.test/press", bigin_account_id: "91", bigin_from_website: false })]);
      // a one-company update, not a sync run: the last sync's summary is left alone
      expect(t.first("settings", "upsert").map((s) => s.key)).not.toContain("bigin_sources_last");
    });

    it("a cleared address falls back to the Website", async () => {
      const t = fakeDb({ company: { ...ACME, news_page_url: null }, sources: (n) => n === 3 ? dbOk([{ id: "s-new" }]) : dbOk([]) });
      await setCompanyNewsPage({ id: ROW }, "", { crm: fakeCrm(), now: NOW });
      expect(t.first("content_sources", "insert")).toEqual([expect.objectContaining({ url: "https://acme.test/", bigin_account_id: "91", bigin_from_website: true })]);
    });

    it("a cleared address with no Website to fall back on unlinks the source", async () => {
      const t = fakeDb({
        company: { ...ACME, news_page_url: null, website: null },
        sources: (n) => n === 1
          ? dbOk([{ id: "s-old", url: "https://acme.test/news", bigin_account_id: "91", bigin_account_name: "Acme", bigin_only: false, bigin_from_website: false }])
          : dbOk([]),
      });
      await setCompanyNewsPage({ id: ROW }, "", { crm: fakeCrm(), now: NOW });
      expect(t.first("content_sources", "update")).toContainEqual(expect.objectContaining({ bigin_account_id: null }));
      expect(t.first("content_sources", "update")).not.toContainEqual(expect.objectContaining({ active: false }));
    });

    it("leaves sources alone when asked to (Story crawler off)", async () => {
      const t = fakeDb({ company: ACME });
      await setCompanyNewsPage({ id: ROW }, "https://acme.test/press", { crm: fakeCrm(), now: NOW, deriveSources: false });
      expect(t.made.content_sources).toBeUndefined();
    });
  });
});

describe("pushCompanyNewsPage (the crm_push retry)", () => {
  it("does nothing for a company with no pending edit", async () => {
    fakeDb({ company: { ...ACME, news_page_pending_at: null } });
    const crm = fakeCrm();
    expect(await pushCompanyNewsPage("91", { crm, now: NOW })).toBe("nothing");
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
  });

  it("does nothing for a company deleted in Bigin since the edit, so its queued retry ends quietly", async () => {
    fakeDb({ company: { ...ACME, deleted_in_bigin_at: "2026-11-05T03:00:00Z" } });
    const crm = fakeCrm();
    expect(await pushCompanyNewsPage("91", { crm, now: NOW, queueRetry: false })).toBe("nothing");
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
  });

  it("from the retry job, a refusal is reported for the job to retry, not queued twice", async () => {
    fakeDb({ company: ACME });
    const crm = fakeCrm({ updateCompanyNewsPage: vi.fn(async () => { throw new Error("down"); }) });
    expect(await pushCompanyNewsPage("91", { crm, now: NOW, queueRetry: false })).toBe("pending");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("retryPendingCompanyPushes (the crm_sync sweep)", () => {
  it("pushes edits still pending past the grace period", async () => {
    fakeDb({ company: ACME, pending: [{ bigin_id: "91" }] });
    const crm = fakeCrm();
    expect(await retryPendingCompanyPushes({ crm, now: NOW })).toEqual({ pushed: 1, failed: 0 });
    expect(crm.updateCompanyNewsPage).toHaveBeenCalledWith("91", "https://acme.test/press", "News_Page_URL");
  });

  it("leaves a company deleted in Bigin alone: Bigin would only refuse it again on every sweep", async () => {
    const t = fakeDb({ company: { ...ACME, deleted_in_bigin_at: "2026-11-05T03:00:00Z" }, pending: [{ bigin_id: "91" }] });
    const crm = fakeCrm();
    expect(await retryPendingCompanyPushes({ crm, now: NOW })).toEqual({ pushed: 0, failed: 0 });
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
    // left out of the sweep's read too, so a pile of them can't fill its batch and starve live ones
    expect(t.calls("crm_companies", "is")).toContainEqual(["deleted_in_bigin_at", null]);
  });

  it("waits while the token can't write companies, rather than failing every 15 minutes", async () => {
    fakeDb({ company: ACME, pending: [{ bigin_id: "91" }], access: { allowed: false, at: STAMP } });
    const crm = fakeCrm();
    expect(await retryPendingCompanyPushes({ crm, now: NOW })).toEqual({ pushed: 0, failed: 0 });
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
  });
});

describe("checkCompanyWriteAccess", () => {
  it("stores what Bigin says about the write scope", async () => {
    const t = fakeDb({ access: null });
    expect(await checkCompanyWriteAccess({ crm: fakeCrm({ canWriteCompanies: vi.fn(async () => false) }), now: NOW })).toEqual({ allowed: false, at: STAMP });
    expect(t.first("settings", "upsert")).toEqual([{ key: "crm_companies_write", value: { allowed: false, at: STAMP } }]);
  });

  it("keeps the stored answer when Bigin couldn't say", async () => {
    const t = fakeDb({ access: { allowed: true, at: "2026-11-05T00:00:00Z" } });
    expect(await checkCompanyWriteAccess({ crm: fakeCrm({ canWriteCompanies: vi.fn(async () => null) }), now: NOW })).toEqual({ allowed: true, at: "2026-11-05T00:00:00Z" });
    expect(t.first("settings", "upsert")).toEqual([]);
  });
});
