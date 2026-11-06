import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MOCK_KEY_HEADER, mockBiginKey, type LocalContact } from "@/lib/adapters/crm";
import { serviceDb } from "@/lib/db/server";
import { DELETE as deleteContact, GET as getContact, PUT as putContact } from "@/app/api/mock/bigin/bigin/v2/Contacts/[id]/route";
import { GET as listContacts, POST as createContact } from "@/app/api/mock/bigin/bigin/v2/Contacts/route";
import { GET as searchContacts } from "@/app/api/mock/bigin/bigin/v2/Contacts/search/route";
import { GET as listAccounts } from "@/app/api/mock/bigin/bigin/v2/Accounts/route";
import { org } from "@/app/api/mock/bigin/store";
import { asDb, dbOk, fromByTable, mockDb, queryBuilder } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

/**
 * The Preview-only Bigin mock (/api/mock/bigin/*): who may call it, and that
 * it answers the way real Bigin does where the adapter's behaviour depends on
 * the answer — a deleted record above all. The last block drives the real
 * adapter against the real mock routes, so the two can't drift apart.
 */
const BASE = "https://preview.example";
const API = `${BASE}/api/mock/bigin/bigin/v2`;
const PRIYA = "9200000000001"; // seeded by store.ts

beforeEach(() => {
  delete (globalThis as { __biginMockOrg?: unknown }).__biginMockOrg; // a fresh org per test
  vi.stubEnv("MOCK_INTEGRATIONS", "1");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("SITE_URL", BASE);
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-deployment-key");
});

afterEach(() => {
  resetDbServerMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const authed = (extra: Record<string, string> = {}) => ({
  authorization: "Zoho-oauthtoken anything",
  [MOCK_KEY_HEADER]: mockBiginKey()!,
  ...extra,
});
const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) =>
  new NextRequest(url, {
    method: init.method ?? "GET",
    headers: init.headers ?? authed(),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("guard", () => {
  it("refuses a Zoho-style token on its own — anyone could send one", async () => {
    const res = await listContacts(req(`${API}/Contacts`, { headers: { authorization: "Zoho-oauthtoken anything" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("refuses a wrong mock key", async () => {
    const res = await listContacts(req(`${API}/Contacts`, { headers: authed({ [MOCK_KEY_HEADER]: "0".repeat(64) }) }));
    expect(res.status).toBe(401);
  });

  it("serves the deployment's own adapter, which sends the key", async () => {
    const res = await listContacts(req(`${API}/Contacts`));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(3);
  });

  it("fails closed when the deployment has no secret key to derive one from", async () => {
    const key = mockBiginKey()!;
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(mockBiginKey()).toBeNull();
    const res = await listContacts(req(`${API}/Contacts`, { headers: authed({ [MOCK_KEY_HEADER]: key }) }));
    expect(res.status).toBe(401);
  });

  it("is a 404 when the mock is off, key or no key", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await listContacts(req(`${API}/Contacts`))).status).toBe(404);
  });
});

describe("GET /Accounts (story sources from Bigin)", () => {
  it("lists companies with only the named fields, News Page URL included", async () => {
    const res = await listAccounts(req(`${API}/Accounts?fields=Account_Name,News_Page_URL&per_page=200&page=1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.info.more_records).toBe(false);
    expect(body.data).toContainEqual({ id: "9100000000001", Account_Name: "Acme Fabrication Ltd", News_Page_URL: "https://acme-fabrication.test/news/" });
    expect(body.data).toContainEqual({ id: "9100000000003", Account_Name: "Northern Laser Cutting", News_Page_URL: null });
  });

  it("is guarded like every other mock route", async () => {
    const res = await listAccounts(req(`${API}/Accounts?fields=Account_Name`, { headers: { authorization: "Zoho-oauthtoken anything" } }));
    expect(res.status).toBe(401);
  });
});

describe("a deleted record, as Bigin answers it", () => {
  beforeEach(() => {
    org().contacts.delete(PRIYA);
  });

  it("GET → 204, Bigin's 'resource does not exist'", async () => {
    expect((await getContact(req(`${API}/Contacts/${PRIYA}`), params(PRIYA))).status).toBe(204);
  });

  it("PUT → 400 INVALID_DATA 'the id given seems to be invalid', naming no field", async () => {
    const res = await putContact(req(`${API}/Contacts/${PRIYA}`, { method: "PUT", body: { data: [{ Email: "x@y.z" }] } }), params(PRIYA));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      data: [{ code: "INVALID_DATA", details: { id: PRIYA }, message: "the id given seems to be invalid", status: "error" }],
    });
  });

  it("DELETE of an id it doesn't have → the same refusal", async () => {
    expect((await deleteContact(req(`${API}/Contacts/${PRIYA}`, { method: "DELETE" }), params(PRIYA))).status).toBe(400);
  });
});

describe("a write naming a company Bigin doesn't have", () => {
  it("is refused on the Account_Name lookup, not silently dropped", async () => {
    const res = await putContact(
      req(`${API}/Contacts/${PRIYA}`, { method: "PUT", body: { data: [{ Account_Name: { id: "9100000000999" } }] } }),
      params(PRIYA),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).data[0]).toMatchObject({ code: "INVALID_DATA", details: { api_name: "Account_Name", id: "9100000000999" } });
    const created = await createContact(req(`${API}/Contacts`, { method: "POST", body: { data: [{ Last_Name: "X", Account_Name: { id: "9100000000999" } }] } }));
    expect((await created.json()).data[0]).toMatchObject({ code: "INVALID_DATA" });
  });
});

describe("DELETE /Contacts/{id}", () => {
  it("removes the record and answers per record, like Bigin's delete-records API", async () => {
    const res = await deleteContact(req(`${API}/Contacts/${PRIYA}`, { method: "DELETE" }), params(PRIYA));
    expect(await res.json()).toEqual({ data: [{ code: "SUCCESS", details: { id: PRIYA }, message: "record deleted", status: "success" }] });
    expect(org().contacts.has(PRIYA)).toBe(false);
  });
});

describe("the adapter against the mock", () => {
  /** Route the adapter's fetches into the mock's own handlers. The token exchange is answered here. */
  function wireFetchToMock() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === `${BASE}/api/mock/bigin/oauth/v2/token`) {
        return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), { status: 200 });
      }
      const r = new NextRequest(url, init as ConstructorParameters<typeof NextRequest>[1]);
      const path = new URL(url).pathname.replace("/api/mock/bigin/bigin/v2", "");
      if (path === "/Contacts/search") return searchContacts(r);
      if (path === "/Accounts") return listAccounts(r);
      if (path === "/Contacts") return init?.method === "POST" ? createContact(r) : listContacts(r);
      const id = /^\/Contacts\/(\d+)$/.exec(path)?.[1];
      if (id) {
        const handler = { GET: getContact, PUT: putContact, DELETE: deleteContact }[init?.method ?? "GET"];
        if (handler) return handler(r, params(id));
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
  }

  it("lists every company with the company sync's fields, the one with no address included", async () => {
    vi.stubEnv("BIGIN_CLIENT_ID", "mock-id");
    vi.stubEnv("BIGIN_CLIENT_SECRET", "mock-secret");
    vi.stubEnv("BIGIN_REFRESH_TOKEN", "mock-refresh");
    wireFetchToMock();

    vi.resetModules(); // the adapter caches its token at module scope
    const { getCrmSync } = await import("@/lib/adapters/crm");
    const read = await getCrmSync().listCompanies();

    expect(read?.complete).toBe(true);
    expect(read?.companies.map((c) => ({ id: c.id, name: c.name, newsPageUrl: c.newsPageUrl, website: c.website }))).toEqual([
      { id: "9100000000001", name: "Acme Fabrication Ltd", newsPageUrl: "https://acme-fabrication.test/news/", website: "https://acme-fabrication.test" },
      { id: "9100000000002", name: "Brightsteel Engineering", newsPageUrl: "https://brightsteel.test/blog", website: null },
      { id: "9100000000003", name: "Northern Laser Cutting", newsPageUrl: null, website: "https://northern-laser.test" },
      { id: "9100000000004", name: "Fenland Tooling", newsPageUrl: null, website: null },
    ]);
  });

  it("repairs a link to a contact deleted in Bigin: unlinks, recreates, links the new record", async () => {
    vi.stubEnv("BIGIN_CLIENT_ID", "mock-id");
    vi.stubEnv("BIGIN_CLIENT_SECRET", "mock-secret");
    vi.stubEnv("BIGIN_REFRESH_TOKEN", "mock-refresh");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    org().contacts.delete(PRIYA); // deleted in Bigin; the delete notification never arrived

    const row: LocalContact = {
      id: "c1", email: "priya@acme-fab.example", name: "Priya Shah", company: null,
      bigin_id: PRIYA, bigin_company_id: null, bigin_company_name: null, bigin_modified_at: null,
      subscribed: true, unsubscribed_at: null, crm_dirty_at: "2026-10-16T09:00:00Z",
    };
    const updates: unknown[] = [];
    vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({
      from: fromByTable({
        contacts: () => {
          const b = queryBuilder(dbOk(row));
          b.update = vi.fn((patch: unknown) => {
            updates.push(patch);
            return b;
          });
          return b;
        },
      }),
    })));
    const fetchSpy = wireFetchToMock();

    vi.resetModules(); // the adapter caches its token at module scope
    const { getCrmSync } = await import("@/lib/adapters/crm");
    await getCrmSync().pushContact("c1");

    const recreated = [...org().contacts.values()].find((c) => c.Email === "priya@acme-fab.example");
    expect(recreated).toBeDefined();
    expect(recreated!.id).not.toBe(PRIYA);
    expect(updates).toEqual([
      { bigin_id: null, bigin_modified_at: null },
      expect.objectContaining({ bigin_id: recreated!.id, crm_dirty_at: null }),
    ]);
    // every call carried the mock key — the guard let them all through
    expect(fetchSpy.mock.calls.filter(([u]) => !String(u).includes("/oauth/")).every(([, i]) => (i?.headers as Record<string, string>)[MOCK_KEY_HEADER])).toBe(true);
  });
});
