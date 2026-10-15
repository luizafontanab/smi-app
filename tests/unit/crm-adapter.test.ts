import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contactPayload,
  escapeCriteria,
  getCrmSync,
  reconcile,
  splitName,
  webhookTokenMatches,
  type BiginContact,
  type LocalContact,
} from "@/lib/adapters/crm";
import { serviceDb } from "@/lib/db/server";
import { asDb, dbError, dbOk, fromByTable, mockDb, queryBuilder, type DbResult } from "../stubs/supabase";
import { resetDbServerMocks } from "../stubs/db-server";

vi.mock("@/lib/db/server", () => import("../stubs/db-server"));

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs", () => ({ enqueue }));

afterEach(() => {
  resetDbServerMocks();
  enqueue.mockReset().mockResolvedValue(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ---------- helpers ---------- */

const API = "https://www.zohoapis.eu/bigin/v2";
const NOW = new Date("2026-10-07T12:00:00.000Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noContent = () => new Response(null, { status: 204 });
const written = (id: string) => json({ data: [{ code: "SUCCESS", details: { id }, message: "ok", status: "success" }] });

function local(over: Partial<LocalContact> = {}): LocalContact {
  return {
    id: "c1", email: "a@b.com", name: null, company: null,
    bigin_id: null, bigin_company_id: null, bigin_company_name: null, bigin_modified_at: null,
    subscribed: true, unsubscribed_at: null, crm_dirty_at: null,
    ...over,
  };
}

function record(over: Partial<BiginContact> = {}): BiginContact {
  return { id: "500", Email: "a@b.com", Full_Name: "Ada Byron", Email_Opt_Out: false, Modified_Time: "2026-10-07T10:00:00+00:00", ...over };
}

/**
 * Fake fetch, routed by URL rather than call order — the token call is
 * answered here, everything else by `handler`. An unexpected call throws, so a
 * request the code shouldn't make fails the test instead of passing quietly.
 */
function fetchRoutes(handler: (url: string, init: RequestInit | undefined) => Response | undefined) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "https://accounts.zoho.eu/oauth/v2/token") return json({ access_token: "tok1", expires_in: 3600 });
    const res = handler(url, init);
    if (!res) throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    return res;
  });
}

const calls = (spy: ReturnType<typeof fetchRoutes>) =>
  spy.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${String(u)}`).filter((c) => !c.includes("/oauth/"));
/** The JSON body of the first write whose URL ends with `suffix`. */
const bodyOf = (spy: ReturnType<typeof fetchRoutes>, suffix: string) => {
  const call = spy.mock.calls.find(([u, i]) => String(u).endsWith(suffix) && i?.body !== undefined);
  return JSON.parse(String(call?.[1]?.body));
};

type Builder = ReturnType<typeof queryBuilder>;
const fnCalls = (b: Builder, method: string) => (b[method] as ReturnType<typeof vi.fn>).mock.calls;

/** Table-routed fake that keeps every builder it hands out, so writes can be inspected per table. */
function db(results: Record<string, DbResult | (() => DbResult)>) {
  const made: Record<string, Builder[]> = {};
  const from = fromByTable(
    Object.fromEntries(Object.entries(results).map(([table, result]) => [table, () => {
      const b = queryBuilder(result);
      (made[table] ??= []).push(b);
      return b;
    }])),
  );
  vi.mocked(serviceDb).mockReturnValue(asDb(mockDb({ from })));
  const writes = (table: string, method: "update" | "insert" | "upsert") =>
    (made[table] ?? []).flatMap((b) => fnCalls(b, method).map((c) => c[0]));
  const filters = (table: string, method: string) => (made[table] ?? []).flatMap((b) => fnCalls(b, method));
  return { writes, filters };
}

function liveEnv() {
  vi.stubEnv("BIGIN_CLIENT_ID", "id_1");
  vi.stubEnv("BIGIN_CLIENT_SECRET", "secret_1");
  vi.stubEnv("BIGIN_REFRESH_TOKEN", "refresh_1");
  vi.stubEnv("MOCK_INTEGRATIONS", "");
}

async function freshCrm() {
  // cachedToken lives at module scope by design; reset the module so it doesn't leak between tests.
  vi.resetModules();
  const mod = await import("@/lib/adapters/crm");
  return mod;
}

/* ---------- pure mapping ---------- */

describe("splitName", () => {
  it("splits at the last space so a two-word first name survives", () => {
    expect(splitName("Mary Ann Smith", "m@x.com")).toEqual({ First_Name: "Mary Ann", Last_Name: "Smith" });
  });
  it("uses a single word as Last_Name, which Bigin requires", () => {
    expect(splitName("Cher", "c@x.com")).toEqual({ Last_Name: "Cher" });
  });
  it("falls back to the email's local part rather than a made-up name", () => {
    expect(splitName(null, "jas.b@smi.com")).toEqual({ Last_Name: "jas.b" });
    expect(splitName("   ", "jas.b@smi.com")).toEqual({ Last_Name: "jas.b" });
  });
});

describe("contactPayload", () => {
  const row = { email: "a@b.com", name: "Ada Byron", unsubscribed_at: null };

  it("sends names on create", () => {
    expect(contactPayload(row, { create: true, account: null })).toEqual({ Email: "a@b.com", First_Name: "Ada", Last_Name: "Byron" });
  });

  it("leaves Bigin's names alone on an update unless the name was edited here", () => {
    expect(contactPayload(row, { create: false, account: null })).toEqual({ Email: "a@b.com" });
    expect(contactPayload(row, { create: false, account: null, nameChanged: true })).toMatchObject({ Last_Name: "Byron" });
  });

  it("never blanks Bigin's Last_Name when the name was cleared here", () => {
    expect(contactPayload({ ...row, name: null }, { create: false, account: null, nameChanged: true })).toEqual({ Email: "a@b.com" });
  });

  it("pushes a local unsubscribe as Email_Opt_Out", () => {
    expect(contactPayload({ ...row, unsubscribed_at: "2026-01-01T00:00:00Z" }, { create: false, account: null }))
      .toMatchObject({ Email_Opt_Out: true });
  });

  it("only clears Bigin's opt-out on an explicit re-opt-in — an ordinary edit must not undo one made in Bigin", () => {
    expect(contactPayload(row, { create: false, account: null })).not.toHaveProperty("Email_Opt_Out");
    expect(contactPayload(row, { create: false, account: null, reOptIn: true })).toMatchObject({ Email_Opt_Out: false });
  });

  it("links the company by id — Bigin's Account_Name is a lookup", () => {
    expect(contactPayload(row, { create: false, account: { id: "900", name: "Acme" } })).toMatchObject({ Account_Name: { id: "900" } });
  });
});

describe("reconcile", () => {
  it("inserts a new Bigin contact as subscribed when it isn't opted out there", () => {
    const r = reconcile(record({ Account_Name: { id: "900", name: "Acme" } }), null, NOW);
    expect(r).toEqual({
      kind: "insert",
      row: expect.objectContaining({
        email: "a@b.com", name: "Ada Byron", company: "Acme", bigin_id: "500",
        bigin_company_id: "900", bigin_company_name: "Acme",
        subscribed: true, unsubscribed_at: null, source: "bigin",
      }),
    });
  });

  it("inserts a Bigin opt-out as unsubscribed, stamped with Bigin's own time", () => {
    const r = reconcile(record({ Email_Opt_Out: true, Unsubscribed_Time: "2026-09-01T08:00:00+00:00" }), null, NOW);
    expect(r).toMatchObject({ kind: "insert", row: { subscribed: false, unsubscribed_at: "2026-09-01T08:00:00.000Z" } });
  });

  it("lowercases the email so it matches the rows the app writes", () => {
    expect(reconcile(record({ Email: " Ada@B.com " }), null, NOW)).toMatchObject({ row: { email: "ada@b.com" } });
  });

  it("links an existing local contact found by email", () => {
    const r = reconcile(record(), local({ name: "Ada Byron" }), NOW);
    expect(r).toMatchObject({ kind: "update", linked: true, changed: true, patch: { bigin_id: "500" } });
  });

  it("takes Bigin's profile fields for a clean row", () => {
    const r = reconcile(
      record({ Full_Name: "Ada Lovelace", Account_Name: { id: "901", name: "Analytical Ltd" } }),
      local({ bigin_id: "500", name: "Ada Byron" }),
      NOW,
    );
    expect(r).toMatchObject({
      kind: "update",
      patch: { name: "Ada Lovelace", bigin_company_id: "901", bigin_company_name: "Analytical Ltd", company: "Analytical Ltd" },
    });
  });

  it("does not overwrite a row whose local edit hasn't reached Bigin yet", () => {
    const r = reconcile(
      record({ Full_Name: "Stale Name" }),
      local({ bigin_id: "500", name: "Fresh Name", crm_dirty_at: NOW.toISOString() }),
      NOW,
    );
    expect(r.kind === "update" && r.patch).not.toHaveProperty("name");
    expect(r).toMatchObject({ changed: false });
  });

  it("still applies a Bigin opt-out to a dirty row — the safe direction", () => {
    const r = reconcile(record({ Email_Opt_Out: true }), local({ bigin_id: "500", crm_dirty_at: NOW.toISOString() }), NOW);
    expect(r).toMatchObject({ optedOut: true, patch: { subscribed: false, unsubscribed_at: NOW.toISOString() } });
  });

  it("never re-subscribes someone who unsubscribed here, whatever Bigin says", () => {
    const r = reconcile(
      record({ Email_Opt_Out: false }),
      local({ bigin_id: "500", subscribed: false, unsubscribed_at: "2026-01-01T00:00:00.000Z" }),
      NOW,
    );
    expect(r.kind === "update" && r.patch).not.toHaveProperty("subscribed");
    expect(r.kind === "update" && r.patch).not.toHaveProperty("unsubscribed_at");
  });

  it("never restamps an existing unsubscribe", () => {
    const r = reconcile(record({ Email_Opt_Out: true }), local({ bigin_id: "500", subscribed: false, unsubscribed_at: "2026-01-01T00:00:00.000Z" }), NOW);
    expect(r).toMatchObject({ optedOut: false });
    expect(r.kind === "update" && r.patch).not.toHaveProperty("unsubscribed_at");
  });

  it("reports nothing changed when Bigin matches the row", () => {
    const r = reconcile(record(), local({ bigin_id: "500", name: "Ada Byron" }), NOW);
    expect(r).toMatchObject({ kind: "update", changed: false, linked: false });
  });
});

describe("escapeCriteria / webhookTokenMatches", () => {
  it("escapes Zoho criteria syntax inside a value", () => {
    expect(escapeCriteria("Smith (UK), Ltd")).toBe("Smith \\(UK\\)\\, Ltd");
  });

  it("matches the echoed webhook token exactly, and fails closed", () => {
    expect(webhookTokenMatches("s3cret", "s3cret")).toBe(true);
    expect(webhookTokenMatches("s3cret!", "s3cret")).toBe(false);
    expect(webhookTokenMatches(undefined, "s3cret")).toBe(false);
    expect(webhookTokenMatches("s3cret", undefined)).toBe(false);
  });
});

/* ---------- stub ---------- */

describe("getCrmSync — local stub", () => {
  it("is used when the Bigin env vars are incomplete, and only logs a push", async () => {
    vi.stubEnv("BIGIN_CLIENT_ID", "id_1"); // secret + refresh token missing
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const crm = getCrmSync();
    await crm.pushContact("c1");
    expect(crm.live).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("c1"));
  });

  it("no longer stamps last_synced_at on contacts that were never synced", async () => {
    const result = await getCrmSync().sync();
    expect(result).toEqual({ pulled: null, pushed: 0, pushFailed: 0, watch: "skipped" });
    expect(serviceDb).not.toHaveBeenCalled();
  });
});

/* ---------- Bigin: push ---------- */

describe("BiginCrmSync.pushContact", () => {
  it("creates an unlinked contact at /bigin/v2 (not Zoho CRM's /crm/v2), auto-linking the one exactly-matching company", async () => {
    liveEnv();
    const t = db({ contacts: dbOk(local({ name: "Ada Byron", company: "Acme" })) });
    const fetchSpy = fetchRoutes((url) => {
      if (url.startsWith(`${API}/Accounts/search`)) return json({ data: [{ id: "900", Account_Name: "Acme" }] });
      if (url.startsWith(`${API}/Contacts/search`)) return noContent();
      if (url === `${API}/Contacts`) return written("500");
    });

    await (await freshCrm()).getCrmSync().pushContact("c1");

    expect(calls(fetchSpy)).toEqual([
      `GET ${API}/Accounts/search?criteria=${encodeURIComponent("(Account_Name:equals:Acme)")}`,
      `GET ${API}/Contacts/search?criteria=${encodeURIComponent("(Email:equals:a@b.com)")}`,
      `POST ${API}/Contacts`,
    ]);
    expect(bodyOf(fetchSpy, "/Contacts")).toEqual({
      data: [{ Email: "a@b.com", First_Name: "Ada", Last_Name: "Byron", Account_Name: { id: "900" } }],
      trigger: [],
    });
    expect(t.writes("contacts", "update")).toEqual([
      expect.objectContaining({ bigin_id: "500", crm_dirty_at: null, bigin_company_id: "900", bigin_company_name: "Acme" }),
    ]);
    expect(t.filters("contacts", "eq")).toContainEqual(["id", "c1"]);
  });

  it("updates by the stored bigin_id — an email changed here must not orphan the Bigin record", async () => {
    liveEnv();
    const t = db({ contacts: dbOk(local({ email: "new@b.com", bigin_id: "500", unsubscribed_at: "2026-10-01T00:00:00Z" })) });
    const fetchSpy = fetchRoutes((url) => (url === `${API}/Contacts/500` ? written("500") : undefined));

    await (await freshCrm()).getCrmSync().pushContact("c1");

    expect(calls(fetchSpy)).toEqual([`PUT ${API}/Contacts/500`]);
    expect(bodyOf(fetchSpy, "/Contacts/500")).toEqual({ data: [{ Email: "new@b.com", Email_Opt_Out: true }], trigger: [] });
    expect(t.writes("contacts", "update")[0]).toMatchObject({ bigin_id: "500", crm_dirty_at: null });
  });

  it("A20: updates the Bigin contact found by email instead of creating a duplicate", async () => {
    liveEnv();
    db({ contacts: dbOk(local()) });
    const fetchSpy = fetchRoutes((url) => {
      if (url.startsWith(`${API}/Contacts/search`)) return json({ data: [{ id: "777" }] });
      if (url === `${API}/Contacts/777`) return written("777");
    });

    await (await freshCrm()).getCrmSync().pushContact("c1");

    expect(calls(fetchSpy).at(-1)).toBe(`PUT ${API}/Contacts/777`);
  });

  it("links no company when the name matches several in Bigin", async () => {
    liveEnv();
    const t = db({ contacts: dbOk(local({ company: "Acme" })) });
    const fetchSpy = fetchRoutes((url) => {
      if (url.startsWith(`${API}/Accounts/search`)) return json({ data: [{ id: "900", Account_Name: "Acme" }, { id: "901", Account_Name: "Acme" }] });
      if (url.startsWith(`${API}/Contacts/search`)) return noContent();
      if (url === `${API}/Contacts`) return written("500");
    });

    await (await freshCrm()).getCrmSync().pushContact("c1");

    expect(bodyOf(fetchSpy, `${API}/Contacts`).data[0]).not.toHaveProperty("Account_Name");
    expect(t.writes("contacts", "update")[0]).not.toHaveProperty("bigin_company_id");
  });

  it("treats a per-record rejection as a failure even though it arrives as HTTP 202", async () => {
    liveEnv();
    const t = db({ contacts: dbOk(local({ bigin_id: "500" })) });
    fetchRoutes(() => json({ data: [{ code: "INVALID_DATA", details: { api_name: "Email" }, message: "invalid data", status: "error" }] }, 202));

    await expect((await freshCrm()).getCrmSync().pushContact("c1")).rejects.toThrow(/INVALID_DATA/);
    expect(t.writes("contacts", "update")).toEqual([]); // stays dirty for the retry
  });

  it("fails rather than create when the duplicate check itself fails — no duplicates over speed", async () => {
    liveEnv();
    db({ contacts: dbOk(local()) });
    const fetchSpy = fetchRoutes((url) => (url.includes("/search") ? new Response("boom", { status: 500 }) : undefined));

    await expect((await freshCrm()).getCrmSync().pushContact("c1")).rejects.toThrow(/500/);
    expect(calls(fetchSpy).some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("does nothing for a contact deleted since the push was queued", async () => {
    liveEnv();
    db({ contacts: dbOk(null) });
    const fetchSpy = fetchRoutes(() => undefined);
    await (await freshCrm()).getCrmSync().pushContact("gone");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reuses a cached token across calls instead of refreshing every time", async () => {
    liveEnv();
    db({ contacts: dbOk(local({ bigin_id: "500" })) });
    const fetchSpy = fetchRoutes(() => written("500"));
    const crm = (await freshCrm()).getCrmSync();
    await crm.pushContact("c1");
    await crm.pushContact("c1");
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("/oauth/"))).toHaveLength(1);
  });

  it("throws when the token refresh is rejected", async () => {
    liveEnv();
    db({ contacts: dbOk(local()) });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad refresh token", { status: 400 }));
    await expect((await freshCrm()).getCrmSync().pushContact("c1")).rejects.toThrow(/400/);
  });
});

/* ---------- Bigin: pull ---------- */

describe("BiginCrmSync.pull", () => {
  const page = (data: BiginContact[], info: Record<string, unknown> = { more_records: false }) => json({ data, info });

  it("does nothing until the first import has been run from the console", async () => {
    liveEnv();
    db({ settings: dbOk(null) });
    const fetchSpy = fetchRoutes(() => undefined);
    expect(await (await freshCrm()).getCrmSync().pull()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("first import: inserts new contacts, skips ones without email and Bigin-side duplicates, then saves the cursor", async () => {
    liveEnv();
    const t = db({ settings: dbOk(null), contacts: dbOk([]) });
    const fetchSpy = fetchRoutes((url) => url.startsWith(`${API}/Contacts?`) ? page([
      record({ id: "1", Email: "new@b.com", Modified_Time: "2026-10-07T10:00:00+00:00" }),
      record({ id: "2", Email: "out@b.com", Email_Opt_Out: true, Modified_Time: "2026-10-06T10:00:00+00:00" }),
      record({ id: "3", Email: null }),
      record({ id: "4", Email: "NEW@b.com" }),
    ]) : undefined);

    const summary = await (await freshCrm()).getCrmSync().pull({ allowFirstImport: true });

    expect(calls(fetchSpy)[0]).toContain("fields=Email,First_Name,Last_Name,Full_Name,Account_Name,Email_Opt_Out,Unsubscribed_Time,Modified_Time");
    expect(calls(fetchSpy)[0]).toContain("sort_by=Modified_Time&sort_order=desc&per_page=200&page=1");
    expect(summary).toMatchObject({ firstImport: true, fetched: 4, inserted: 2, optedOut: 1, skippedNoEmail: 1, duplicates: 1 });
    expect(t.writes("contacts", "insert")).toEqual([[
      expect.objectContaining({ email: "new@b.com", bigin_id: "1", subscribed: true }),
      expect.objectContaining({ email: "out@b.com", bigin_id: "2", subscribed: false, unsubscribed_at: expect.any(String) }),
    ]]);
    expect(t.writes("settings", "upsert")).toEqual([{ key: "crm_sync_cursor", value: { since: "2026-10-07T10:00:00+00:00" } }]);
  });

  it("a dry run reports the same counts and writes nothing", async () => {
    liveEnv();
    const t = db({ settings: dbOk(null), contacts: dbOk([local({ email: "old@b.com" })]) });
    fetchRoutes((url) => url.startsWith(`${API}/Contacts?`) ? page([record({ id: "1", Email: "new@b.com" }), record({ id: "2", Email: "old@b.com" })]) : undefined);

    const summary = await (await freshCrm()).getCrmSync().pull({ dryRun: true, allowFirstImport: true });

    expect(summary).toMatchObject({ dryRun: true, inserted: 1, linked: 1 });
    expect(t.writes("contacts", "insert")).toEqual([]);
    expect(t.writes("contacts", "update")).toEqual([]);
    expect(t.writes("settings", "upsert")).toEqual([]);
  });

  it("links an existing local contact found by email instead of inserting a second one", async () => {
    liveEnv();
    const t = db({ settings: dbOk({ value: { since: "2026-10-01T00:00:00Z" } }), contacts: dbOk([local({ id: "c9", email: "old@b.com" })]) });
    fetchRoutes((url) => url.startsWith(`${API}/Contacts?`) ? page([record({ id: "77", Email: "old@b.com" })]) : undefined);

    const summary = await (await freshCrm()).getCrmSync().pull();

    expect(summary).toMatchObject({ inserted: 0, linked: 1 });
    expect(t.writes("contacts", "update")).toEqual([expect.objectContaining({ bigin_id: "77" })]);
    expect(t.filters("contacts", "eq")).toContainEqual(["id", "c9"]);
  });

  it("counts an email already linked to a different Bigin record as a duplicate and leaves it alone", async () => {
    liveEnv();
    const t = db({ settings: dbOk({ value: { since: "2026-10-01T00:00:00Z" } }), contacts: dbOk([local({ email: "old@b.com", bigin_id: "11" })]) });
    fetchRoutes((url) => url.startsWith(`${API}/Contacts?`) ? page([record({ id: "22", Email: "old@b.com" })]) : undefined);

    expect(await (await freshCrm()).getCrmSync().pull()).toMatchObject({ duplicates: 1, linked: 0 });
    expect(t.writes("contacts", "update")).toEqual([]);
  });

  it("an incremental pull stops at the cursor instead of reading the whole org", async () => {
    liveEnv();
    db({ settings: dbOk({ value: { since: "2026-10-07T00:00:00Z" } }), contacts: dbOk([]) });
    const fetchSpy = fetchRoutes((url) => url.startsWith(`${API}/Contacts?`) ? page(
      [record({ id: "1", Email: "new@b.com", Modified_Time: "2026-10-07T09:00:00+00:00" }), record({ id: "2", Email: "older@b.com", Modified_Time: "2026-10-01T09:00:00+00:00" })],
      { more_records: true },
    ) : undefined);

    const summary = await (await freshCrm()).getCrmSync().pull();

    expect(summary).toMatchObject({ fetched: 1, inserted: 1 });
    expect(calls(fetchSpy)).toHaveLength(1); // more_records, but the cursor was reached
  });

  it("follows next_page_token past the first page", async () => {
    liveEnv();
    db({ settings: dbOk(null), contacts: dbOk([]) });
    let n = 0;
    const fetchSpy = fetchRoutes((url) => {
      if (!url.startsWith(`${API}/Contacts?`)) return undefined;
      return n++ === 0
        ? page([record({ id: "1", Email: "a1@b.com" })], { more_records: true, next_page_token: "tok-2" })
        : page([record({ id: "2", Email: "a2@b.com" })]);
    });

    const summary = await (await freshCrm()).getCrmSync().pull({ allowFirstImport: true });

    expect(summary).toMatchObject({ inserted: 2 });
    expect(calls(fetchSpy)[1]).toContain("page_token=tok-2");
  });

  it("does not move the cursor when a page fails mid-run, so the next run retries from the same point", async () => {
    liveEnv();
    const t = db({ settings: dbOk(null), contacts: dbOk([]) });
    let n = 0;
    fetchRoutes((url) => {
      if (!url.startsWith(`${API}/Contacts?`)) return undefined;
      return n++ === 0 ? page([record({ id: "1", Email: "a1@b.com" })], { more_records: true }) : new Response("busy", { status: 500 });
    });

    await expect((await freshCrm()).getCrmSync().pull({ allowFirstImport: true })).rejects.toThrow(/500/);
    expect(t.writes("settings", "upsert")).toEqual([]);
  });
});

/* ---------- Bigin: webhook paths ---------- */

describe("BiginCrmSync.pullIds / unlink", () => {
  it("re-reads each notified id from Bigin before applying it", async () => {
    liveEnv();
    const t = db({ settings: dbOk({ value: { since: "2026-10-01T00:00:00Z" } }), contacts: dbOk([]) });
    const fetchSpy = fetchRoutes((url) => (url.startsWith(`${API}/Contacts/88?fields=`) ? json({ data: [record({ id: "88", Email: "hook@b.com" })] }) : undefined));

    await (await freshCrm()).getCrmSync().pullIds(["88"]);

    expect(calls(fetchSpy)).toHaveLength(1);
    expect(t.writes("contacts", "insert")).toEqual([[expect.objectContaining({ email: "hook@b.com", bigin_id: "88" })]]);
  });

  it("ignores notifications until the first import has run", async () => {
    liveEnv();
    db({ settings: dbOk(null) });
    const fetchSpy = fetchRoutes(() => undefined);
    await (await freshCrm()).getCrmSync().pullIds(["88"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unlinks a contact deleted in Bigin, keeping the row and its opt-out", async () => {
    liveEnv();
    const t = db({ contacts: dbOk(null) });
    await (await freshCrm()).getCrmSync().unlink(["88", "89"]);
    expect(t.writes("contacts", "update")).toEqual([{ bigin_id: null, bigin_modified_at: null }]);
    expect(t.filters("contacts", "in")).toContainEqual(["bigin_id", ["88", "89"]]);
    expect(t.writes("contacts", "insert")).toEqual([]);
  });
});

/* ---------- Bigin: sync job ---------- */

describe("BiginCrmSync.sync", () => {
  it("retries stuck pushes, pulls, and records the run for the console", async () => {
    liveEnv();
    let contactsCall = 0;
    const t = db({
      settings: dbOk({ value: { since: "2026-10-07T00:00:00Z" } }),
      // 1: the dirty sweep, 2: pushContact's read, then pull's lookups
      contacts: () => (++contactsCall === 1 ? dbOk([{ id: "c1" }]) : contactsCall === 2 ? dbOk(local({ bigin_id: "500" })) : dbOk([])),
    });
    fetchRoutes((url) => {
      if (url === `${API}/Contacts/500`) return written("500");
      if (url.startsWith(`${API}/Contacts?`)) return noContent();
    });

    const result = await (await freshCrm()).getCrmSync().sync();

    expect(result).toMatchObject({ pushed: 1, pushFailed: 0, watch: "skipped", pulled: { fetched: 0 } });
    expect(t.filters("contacts", "not")).toContainEqual(["crm_dirty_at", "is", null]);
    expect(t.writes("settings", "upsert")).toContainEqual(expect.objectContaining({ key: "crm_sync_last", value: expect.objectContaining({ pushed: 1, preview: false }) }));
  });

  it("throws after recording when a retried push fails, so the job surfaces in Needs You Today", async () => {
    liveEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let contactsCall = 0;
    const t = db({
      settings: dbOk({ value: { since: "2026-10-07T00:00:00Z" } }),
      contacts: () => (++contactsCall === 1 ? dbOk([{ id: "c1" }]) : contactsCall === 2 ? dbOk(local({ bigin_id: "500" })) : dbOk([])),
    });
    fetchRoutes((url) => {
      if (url === `${API}/Contacts/500`) return new Response("nope", { status: 500 });
      if (url.startsWith(`${API}/Contacts?`)) return noContent();
    });

    await expect((await freshCrm()).getCrmSync().sync()).rejects.toThrow(/1 of 1 pending pushes failed/);
    expect(t.writes("settings", "upsert")).toContainEqual(expect.objectContaining({ key: "crm_sync_last" }));
  });

  it("opens the webhook channel once there is something to keep in step", async () => {
    liveEnv();
    vi.stubEnv("BIGIN_WEBHOOK_TOKEN", "hook-token");
    vi.stubEnv("SITE_URL", "https://smi.example");
    const t = db({ settings: dbOk({ value: { since: "2026-10-07T00:00:00Z" } }), contacts: dbOk([]) });
    const fetchSpy = fetchRoutes((url, init) => {
      if (url.startsWith(`${API}/Contacts?`)) return noContent();
      if (url === `${API}/actions/watch` && init?.method === "POST") return json({ watch: [{ code: "SUCCESS" }] });
    });

    // the fake answers every settings key with the cursor row, so no valid
    // channel is stored — sync must open one
    const result = await (await freshCrm()).getCrmSync().sync();

    expect(result.watch).toBe("ok");
    const watch = bodyOf(fetchSpy, "/actions/watch").watch[0];
    expect(watch).toMatchObject({ events: ["Contacts.all"], notify_url: "https://smi.example/api/webhooks/bigin", token: "hook-token" });
    expect(watch.channel_expiry).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/);
    expect(t.writes("settings", "upsert")).toContainEqual(expect.objectContaining({ key: "crm_watch" }));
  });
});

/* ---------- write-through helper ---------- */

describe("syncContactToCrm", () => {
  it("marks the row dirty, pushes, and queues a retry instead of throwing when Bigin fails", async () => {
    liveEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = db({ contacts: dbOk(local({ bigin_id: "500" })) });
    fetchRoutes(() => new Response("down", { status: 503 }));

    const { syncContactToCrm } = await freshCrm();
    await expect(syncContactToCrm("c1", { nameChanged: true, reOptIn: true })).resolves.toBeUndefined();

    expect(t.writes("contacts", "update")[0]).toEqual({ crm_dirty_at: expect.any(String) });
    expect(enqueue).toHaveBeenCalledWith("crm_push", { contact_id: "c1", name_changed: true, re_opt_in: true }, expect.any(Date));
  });

  it("does not mark anything dirty or queue anything with Bigin unconnected", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { syncContactToCrm } = await freshCrm();
    await syncContactToCrm("c1");
    expect(serviceDb).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("swallows a failure to queue the retry too — the dirty flag still gets it pushed later", async () => {
    liveEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    db({ contacts: () => dbError("db down") as DbResult });
    enqueue.mockRejectedValueOnce(new Error("queue down"));
    const { syncContactToCrm } = await freshCrm();
    await expect(syncContactToCrm("c1")).resolves.toBeUndefined();
  });
});
