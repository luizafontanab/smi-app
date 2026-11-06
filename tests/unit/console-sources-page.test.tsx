// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SourcesPage from "@/app/console/sources/page";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

/*
 * Story Sources after #51: only what's about reading sources. The Bigin panel
 * moved to CRM's Companies box; a Bigin-linked source links to its company there.
 */

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));
vi.mock("@/lib/auth", () => ({ requireConsole: vi.fn(async () => ({ userId: "admin1", role: "admin" })) }));
vi.mock("@/lib/adapters/crm", () => ({ getCrmSync: () => ({ live: true }) }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock("@/lib/sources/run", async (orig) => ({ ...(await orig<typeof import("@/lib/sources/run")>()), readSourceCheckRun: vi.fn(async () => null) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

afterEach(() => resetDbServerMocks());

const props = (searchParams: Record<string, string>) =>
  ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }) as never;

const source = (over: Record<string, unknown>) => ({
  id: "s1", url: "https://acme.test/news", domain: "acme.test", label: null, active: true, method: null, method_url: null,
  access: "ok", last_checked_at: null, last_item_at: null, failure_count: 0, last_error: null,
  bigin_account_id: null, bigin_account_name: null, bigin_from_website: false, member: null, ...over,
});

function wire(rows: Record<string, unknown>[]) {
  const list = queryBuilder(dbOk(rows, rows.length));
  let call = 0;
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
    from: fromByTable({
      // first the page of sources, then the unpaged counts
      content_sources: () => (call++ === 0 ? list : queryBuilder(dbOk(rows))),
    }),
  })));
  return list;
}

describe("Story Sources (view=sources)", () => {
  it("has no Bigin sync panel or button, only a pointer to CRM's Companies box", async () => {
    wire([]);
    render(await SourcesPage(props({ view: "sources" })));

    expect(screen.queryByRole("heading", { name: "From Bigin" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sync from Bigin/ })).toBeNull();
    expect(screen.getByRole("link", { name: "CRM → Companies" })).toHaveAttribute("href", "/console/crm#companies");
  });

  it("names a Bigin-linked source's CRM company, linking to it on CRM", async () => {
    wire([source({ bigin_account_id: "9100000000001", bigin_account_name: "Acme Ltd" })]);
    render(await SourcesPage(props({ view: "sources" })));

    expect(screen.getByRole("link", { name: "Bigin · Acme Ltd" })).toHaveAttribute("href", "/console/crm?cid=9100000000001#companies");
  });

  it("narrows to one company's source when CRM links here", async () => {
    const list = wire([source({ bigin_account_id: "9100000000001", bigin_account_name: "Acme Ltd" })]);
    render(await SourcesPage(props({ view: "sources", company: "9100000000001" })));

    expect(list.eq).toHaveBeenCalledWith("bigin_account_id", "9100000000001");
    expect(screen.getByRole("link", { name: "Show all sources" })).toHaveAttribute("href", "/console/sources?view=sources");
  });
});
