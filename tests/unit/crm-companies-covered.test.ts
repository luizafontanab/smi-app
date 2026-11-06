import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptImportedNewsPage } from "@/app/console/crm/actions";
import { adoptImportedSource } from "@/lib/crm-companies/covered";
import type { CrmSync } from "@/lib/adapters/crm";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));
// For the action: the console guard, and the Bigin connection it reaches through getCrmSync.
const { requireConsole, liveCrm } = vi.hoisted(() => ({
  requireConsole: vi.fn(async () => ({ userId: "admin1", email: "jas@smi.local", role: "admin", memberId: null, displayName: "Jas" })),
  liveCrm: { current: null as unknown },
}));
vi.mock("@/lib/auth", () => ({ requireConsole }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/adapters/crm", async (original) => ({ ...(await original<object>()), getCrmSync: () => liveCrm.current }));

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockClear();
  vi.restoreAllMocks();
});

/*
 * "Use as News Page URL" (issue #56, spec #49): an imported source that
 * covers a company becomes its News Page URL, through #55's write-through
 * (saved, pending, pushed to Bigin), and the existing source row is linked to
 * the company — never a second row for the same address. Runs the real
 * write-through and source planner against the stubbed database; asserts the
 * rows written and the write Bigin receives.
 */

const NOW = () => new Date("2026-11-06T10:00:00Z");
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

const BRIGHT = { id: COMPANY_ID, bigin_id: "91", name: "Bright", website: "https://www.bright.test", news_page_url: null, deleted_in_bigin_at: null };
/** the imported spreadsheet row on Bright's domain, linked to no company */
const IMPORTED = { id: SOURCE_ID, url: "https://bright.test/news", label: "Bright news", domain: "bright.test", bigin_account_id: null as string | null, bigin_only: false };
/** Bright's current source: its Website, added by the Bigin sync */
const WEBSITE_SOURCE = { id: "s-web", url: "https://www.bright.test/", bigin_account_id: "91", bigin_account_name: "Bright", bigin_only: true, bigin_from_website: true };

function fakeCrm() {
  return {
    live: true,
    updateCompanyNewsPage: vi.fn(async () => {}),
    canWriteCompanies: vi.fn(async () => true),
  } as unknown as CrmSync & { updateCompanyNewsPage: ReturnType<typeof vi.fn> };
}

type Builder = ReturnType<typeof queryBuilder>;
const fn = (b: Builder, m: string) => b[m] as ReturnType<typeof vi.fn>;

/**
 * A database holding one company and one imported source. Updates to either
 * are remembered, so a read after the save sees them; content_sources
 * answers by what's asked (its select list).
 */
function fakeDb({ company = BRIGHT as Record<string, unknown> | null, source = IMPORTED as Record<string, unknown> | null, access = { allowed: true, at: "2026-11-05T00:00:00Z" } as { allowed: boolean; at: string } | null } = {}) {
  const stored = source ? { ...source } : null;
  const row = company ? { ...company } : null;
  const sources: Builder[] = [];
  const companies: Builder[] = [];
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      crm_companies: () => {
        const b: Builder = queryBuilder(() => {
          const update = fn(b, "update").mock.calls[0]?.[0];
          if (row && update) Object.assign(row, update);
          return dbOk(row ? { ...row } : null);
        });
        companies.push(b);
        return b;
      },
      settings: () => {
        const b: Builder = queryBuilder(() => {
          const key = fn(b, "eq").mock.calls.find((c) => c[0] === "key")?.[1];
          return dbOk(key === "crm_companies_write" && access ? { value: access } : null);
        });
        return b;
      },
      content_sources: () => {
        const b: Builder = queryBuilder<unknown>(() => {
          if (fn(b, "insert").mock.calls.length) return dbOk([{ id: "duplicate" }]);
          const update = fn(b, "update").mock.calls[0]?.[0];
          if (update) {
            const id = fn(b, "eq").mock.calls.find((c) => c[0] === "id")?.[1];
            if (stored && id === stored.id) Object.assign(stored, update);
            return dbOk(null);
          }
          const select = String(fn(b, "select").mock.calls[0]?.[0] ?? "");
          if (select.startsWith("id, url, bigin_account_id, bigin_account_name")) return dbOk([WEBSITE_SOURCE]); // linked rows
          if (select === "id, url, bigin_account_id, bigin_only") {
            const urls = fn(b, "in").mock.calls[0]?.[1] as string[];
            return dbOk(stored && urls.includes(String(stored.url)) ? [stored] : []);
          }
          if (select.startsWith("id, domain, bigin_account_id")) return dbOk([]); // refreshMembers
          return dbOk(stored); // the source by id
        });
        sources.push(b);
        return b;
      },
      contacts: () => queryBuilder(dbOk([])),
      members: () => queryBuilder(dbOk([])),
    }),
  })));
  const calls = (list: Builder[], m: string) => list.flatMap((b) => fn(b, m).mock.calls.map((c) => c[0]));
  return { stored, sourceInserts: () => calls(sources, "insert"), sourceUpdates: () => calls(sources, "update"), companyUpdates: () => calls(companies, "update") };
}

describe("adoptImportedSource", () => {
  it("saves the source's address as the News Page URL, pushes it, and links that same source: no second row", async () => {
    const t = fakeDb();
    const crm = fakeCrm();

    expect(await adoptImportedSource(COMPANY_ID, SOURCE_ID, { crm, now: NOW })).toEqual({ outcome: "pushed", linked: true });

    expect(t.companyUpdates()[0]).toMatchObject({ news_page_url: "https://bright.test/news", news_page_pending_at: "2026-11-06T10:00:00.000Z" });
    expect(crm.updateCompanyNewsPage).toHaveBeenCalledWith("91", "https://bright.test/news", "News_Page_URL");
    expect(t.sourceInserts()).toEqual([]);
    expect(t.stored).toMatchObject({ id: SOURCE_ID, bigin_account_id: "91", bigin_account_name: "Bright", bigin_from_website: false });
    // the Website source it had is let go, and paused: Bigin made it
    expect(t.sourceUpdates()).toContainEqual(expect.objectContaining({ bigin_account_id: null, active: false }));
  });

  it("is refused while the Bigin token can't write companies: nothing saved, nothing linked", async () => {
    const t = fakeDb({ access: { allowed: false, at: "2026-11-05T00:00:00Z" } });
    const crm = fakeCrm();

    expect(await adoptImportedSource(COMPANY_ID, SOURCE_ID, { crm, now: NOW })).toEqual({ outcome: "not_allowed", linked: false });

    expect(t.companyUpdates()).toEqual([]);
    expect(t.sourceUpdates()).toEqual([]);
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
  });

  it.each([
    ["linked to a company already", { ...IMPORTED, bigin_account_id: "77" }, BRIGHT],
    ["made by the Bigin sync, not imported", { ...IMPORTED, bigin_only: true }, BRIGHT],
    ["on another domain", { ...IMPORTED, domain: "other.test", url: "https://other.test/news" }, BRIGHT],
    ["for a company that has a News Page URL", IMPORTED, { ...BRIGHT, news_page_url: "https://bright.test/press" }],
    ["for a company deleted in Bigin", IMPORTED, { ...BRIGHT, deleted_in_bigin_at: "2026-11-06T03:00:00Z" }],
    ["that doesn't exist", null, BRIGHT],
  ])("refuses a source %s, changing nothing", async (_, source, company) => {
    const t = fakeDb({ source, company });
    const crm = fakeCrm();

    expect(await adoptImportedSource(COMPANY_ID, SOURCE_ID, { crm, now: NOW })).toEqual({ outcome: "not_covering", linked: false });

    expect(t.companyUpdates()).toEqual([]);
    expect(t.sourceUpdates()).toEqual([]);
    expect(crm.updateCompanyNewsPage).not.toHaveBeenCalled();
  });

  it("an unknown company is not found", async () => {
    fakeDb({ company: null });
    expect(await adoptImportedSource(COMPANY_ID, SOURCE_ID, { crm: fakeCrm(), now: NOW })).toEqual({ outcome: "not_found", linked: false });
  });
});

describe("adoptImportedNewsPage, through the real write-through", () => {
  const form = () => {
    const fd = new FormData();
    fd.set("company", COMPANY_ID);
    fd.set("source", SOURCE_ID);
    return fd;
  };

  it("links the existing imported source, with no second row, and pushes the address to Bigin", async () => {
    const t = fakeDb();
    const crm = fakeCrm();
    liveCrm.current = crm;

    await expect(adoptImportedNewsPage(form())).rejects.toThrow(`NEXT_REDIRECT:/console/crm?company=${COMPANY_ID}&companies=imported_used#companies`);

    expect(t.sourceInserts()).toEqual([]);
    expect(t.stored).toMatchObject({ id: SOURCE_ID, bigin_account_id: "91" });
    expect(crm.updateCompanyNewsPage).toHaveBeenCalledWith("91", "https://bright.test/news", "News_Page_URL");
  });

  it("is behind the console guard", async () => {
    const t = fakeDb();
    liveCrm.current = fakeCrm();
    requireConsole.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login?next=/console"));
    await expect(adoptImportedNewsPage(form())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(t.companyUpdates()).toEqual([]);
  });

  it("is refused with \"edit in Bigin for now\" while the token can't write companies, linking nothing", async () => {
    const t = fakeDb({ access: null });
    liveCrm.current = fakeCrm();
    await expect(adoptImportedNewsPage(form())).rejects.toThrow(encodeURIComponent("edit in Bigin for now"));
    expect(t.companyUpdates()).toEqual([]);
    expect(t.sourceUpdates()).toEqual([]);
  });
});
