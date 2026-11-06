import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { MOCK_KEY_HEADER, mockBiginKey } from "@/lib/adapters/crm";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";

/**
 * In-memory stand-in for a Bigin org, shared by the `/api/mock/bigin/bigin/v2/*`
 * routes. Only reachable when `mockBaseUrl()` is set (Preview with
 * MOCK_INTEGRATIONS=1, or local dev with it set by hand). State lives on
 * globalThis so every route module — and every HMR reload — sees the same org;
 * it resets when the server restarts, which is fine for a mock.
 *
 * Shapes follow bigin.com/developer/docs/apis/v2/: numeric string ids,
 * `{ data, info }` lists, per-record `{ code, details, status }` write results.
 */

export type MockContact = {
  id: string;
  Email: string | null;
  First_Name: string | null;
  Last_Name: string;
  Full_Name: string;
  Account_Name: { id: string; name: string } | null;
  Email_Opt_Out: boolean;
  Unsubscribed_Time: string | null;
  Modified_Time: string;
};

/** A company: its id and name, then any other field by API name (the field list below says which). */
export type MockAccount = { id: string; Account_Name: string } & Record<string, unknown>;

/**
 * The Companies update scope (issue #55). The mock's token has it unless a
 * test (or someone poking a Preview) deletes it from `scopes`, to see how
 * the app copes with a token that lacks it — the state production is in
 * until the Bigin token is regenerated with the new scopes (HUMAN-TODO §7).
 */
export const ACCOUNTS_UPDATE_SCOPE = "ZohoBigin.modules.accounts.UPDATE";

/** One entry of Bigin's field list (settings/fields), the keys the adapter reads plus a few it doesn't. */
export type MockField = { api_name: string; display_label: string; field_label: string; data_type: string; custom_field: boolean; visible: boolean };

type Org = {
  contacts: Map<string, MockContact>;
  accounts: MockAccount[];
  /** settings/fields?module=Accounts */
  accountFields: MockField[];
  /** Answer the field list with OAUTH_SCOPE_MISMATCH, as for a token without ZohoBigin.settings.fields.READ. */
  refuseFieldList: boolean;
  /** scopes checked by requireScope (today only ACCOUNTS_UPDATE_SCOPE, #55) */
  scopes: Set<string>;
  nextId: number;
};

const field = (api_name: string, display_label: string, data_type: string, custom_field = false): MockField =>
  // field_label is an i18n key in Bigin's own sample, not the label people see
  ({ api_name, display_label, field_label: custom_field ? display_label : `Accounts crm.label.${api_name.toLowerCase()}`, data_type, custom_field, visible: true });

const g = globalThis as typeof globalThis & { __biginMockOrg?: Org };

function seedOrg(): Org {
  // News_Page_URL feeds the story crawler (src/lib/sources/bigin.ts), with
  // Website as its fallback: one company has only a Website, and one has
  // neither (shown as "no address" in CRM's Companies box), as in a real org.
  // Beyond the three the story crawler needs, a few of Bigin's standard
  // fields and one custom one, so the Companies box's detail view has
  // something to list (issue #54).
  const owner = { name: "Jas", id: "9000000000001" };
  const accounts: MockAccount[] = [
    { id: "9100000000001", Account_Name: "Acme Fabrication Ltd", News_Page_URL: "https://acme-fabrication.test/news/", Website: "https://acme-fabrication.test", Phone: "01234 567890", Billing_City: "Leeds", Machine_Brands: "Trumpf, Amada", Owner: owner, Description: null },
    { id: "9100000000002", Account_Name: "Brightsteel Engineering", News_Page_URL: "https://brightsteel.test/blog", Website: null, Phone: null, Billing_City: "Sheffield", Machine_Brands: null, Owner: owner, Description: "Sheet metal and powder coating." },
    { id: "9100000000003", Account_Name: "Northern Laser Cutting", News_Page_URL: null, Website: "https://northern-laser.test", Phone: null, Billing_City: null, Machine_Brands: "Bystronic", Owner: owner, Description: null },
    { id: "9100000000004", Account_Name: "Fenland Tooling", News_Page_URL: null, Website: null, Phone: null, Billing_City: null, Machine_Brands: null, Owner: owner, Description: null },
  ];
  const accountFields: MockField[] = [
    field("Owner", "Company Owner", "ownerlookup"),
    field("Account_Name", "Company Name", "text"),
    field("Phone", "Phone", "phone"),
    field("Website", "Website", "website"),
    field("Billing_City", "Billing City", "text"),
    field("Description", "Description", "textarea"),
    field("News_Page_URL", "News Page URL", "website", true),
    field("Machine_Brands", "Machine Brands", "text", true),
  ];
  const contacts = new Map<string, MockContact>();
  const now = Date.now();
  const seed: Array<[first: string, last: string, email: string, account: number, optedOut: boolean]> = [
    ["Priya", "Shah", "priya@acme-fab.example", 0, false],
    ["Tom", "Hughes", "tom@brightsteel.example", 1, false],
    ["Grace", "Owen", "grace@northernlaser.example", 2, true],
  ];
  seed.forEach(([first, last, email, acc, out], i) => {
    const id = String(9200000000001 + i);
    contacts.set(id, {
      id,
      Email: email,
      First_Name: first,
      Last_Name: last,
      Full_Name: `${first} ${last}`,
      Account_Name: { id: accounts[acc].id, name: accounts[acc].Account_Name },
      Email_Opt_Out: out,
      Unsubscribed_Time: out ? new Date(now - 86_400_000).toISOString() : null,
      Modified_Time: new Date(now - (i + 1) * 3_600_000).toISOString(),
    });
  });
  return { contacts, accounts, accountFields, refuseFieldList: false, scopes: new Set([ACCOUNTS_UPDATE_SCOPE]), nextId: 9200000000100 };
}

export function org(): Org {
  g.__biginMockOrg ??= seedOrg();
  return g.__biginMockOrg;
}

/**
 * 404 when the mock is off; 401 without a Zoho-style auth header — the same
 * order the real API checks in — or without the deployment's own mock key.
 *
 * The auth header alone proves nothing here: these routes accepted any
 * `Zoho-oauthtoken <anything>`, so on a Preview with MOCK_INTEGRATIONS=1
 * anyone with the URL could read every contact the Preview had pushed. The
 * adapter now sends MOCK_KEY_HEADER too (lib/adapters/crm.ts mockBiginKey, an
 * HMAC of this deployment's SUPABASE_SECRET_KEY), compared in constant time.
 * Real Bigin knows nothing of it; it is the mock's own lock.
 */
export function guard(request: Request): NextResponse | null {
  if (!mockBaseUrl()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const invalid = NextResponse.json({ code: "INVALID_TOKEN", message: "invalid oauth token", status: "error" }, { status: 401 });
  if (!request.headers.get("authorization")?.startsWith("Zoho-oauthtoken ")) return invalid;
  const expected = mockBiginKey();
  const given = request.headers.get(MOCK_KEY_HEADER) ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return invalid;
  return null;
}

/**
 * A call the token's scopes don't cover. Bigin's status-code docs list
 * OAUTH_SCOPE_MISMATCH without an HTTP status; Zoho CRM's (same platform)
 * give it as 401 with this top-level body. Unverified on a live Bigin
 * account (HUMAN-TODO 7.5). It shares 401 with INVALID_TOKEN, so the adapter
 * tells them apart by `code`.
 */
export function requireScope(scope: string): NextResponse | null {
  if (org().scopes.has(scope)) return null;
  return NextResponse.json(
    { code: "OAUTH_SCOPE_MISMATCH", details: {}, message: "invalid oauth scope to access this URL", status: "error" },
    { status: 401 },
  );
}

/**
 * Bigin's answer to a write against a record id it doesn't have — deleted, or
 * never existed. Bigin's status-code docs list INVALID_DATA for "the id
 * specified is incorrect"; Zoho's update-records docs (same platform) give it
 * as HTTP 400 "the id given seems to be invalid". The per-record `data[]`
 * envelope and `details: { id }` follow Zoho's other write errors and are an
 * assumption until a live account confirms them (HUMAN-TODO 7.5).
 */
export const invalidRecordId = (id: string) =>
  NextResponse.json(
    { data: [{ code: "INVALID_DATA", details: { id }, message: "the id given seems to be invalid", status: "error" }] },
    { status: 400 },
  );

/**
 * A lookup pointing at a record Bigin doesn't have — here, Account_Name naming
 * a company that was deleted or merged. Zoho words it "the related id given
 * seems to be invalid" and names the field in details.api_name.
 */
export const invalidAccount = (id: string) => ({
  code: "INVALID_DATA",
  details: { api_name: "Account_Name", json_path: "$.data[0].Account_Name", id },
  message: "the related id given seems to be invalid",
  status: "error",
});

/** The Account_Name a write names, if the org has no such company. */
export function unknownAccount(data: Record<string, unknown>): string | null {
  const account = data.Account_Name as { id?: string } | undefined;
  return account?.id && !org().accounts.some((a) => a.id === account.id) ? account.id : null;
}

/** `(Field:equals:value)` → value, undoing Zoho's backslash escapes. Only the one shape the adapter sends. */
export function equalsCriterion(criteria: string | null, field: string): string | null {
  if (!criteria) return null;
  const m = criteria.match(new RegExp(`^\\(${field}:equals:(.*)\\)$`));
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
}

/** Apply a write payload to a contact, the way Bigin would. */
export function applyWrite(target: MockContact, data: Record<string, unknown>): MockContact {
  const accounts = org().accounts;
  if (typeof data.Email === "string") target.Email = data.Email;
  if (typeof data.First_Name === "string") target.First_Name = data.First_Name;
  if (typeof data.Last_Name === "string") target.Last_Name = data.Last_Name;
  if (typeof data.Email_Opt_Out === "boolean") {
    target.Email_Opt_Out = data.Email_Opt_Out;
    target.Unsubscribed_Time = data.Email_Opt_Out ? new Date().toISOString() : null;
  }
  const account = data.Account_Name as { id?: string } | undefined;
  if (account?.id) {
    const found = accounts.find((a) => a.id === account.id);
    if (found) target.Account_Name = { id: found.id, name: found.Account_Name };
  }
  target.Full_Name = [target.First_Name, target.Last_Name].filter(Boolean).join(" ");
  target.Modified_Time = new Date().toISOString();
  return target;
}

export const success = (id: string, message: string) => ({
  code: "SUCCESS",
  details: { id, Modified_Time: new Date().toISOString() },
  message,
  status: "success",
});
