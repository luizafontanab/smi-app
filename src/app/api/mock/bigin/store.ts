import { NextResponse } from "next/server";
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

type Org = { contacts: Map<string, MockContact>; accounts: { id: string; Account_Name: string }[]; nextId: number };

const g = globalThis as typeof globalThis & { __biginMockOrg?: Org };

function seedOrg(): Org {
  const accounts = [
    { id: "9100000000001", Account_Name: "Acme Fabrication Ltd" },
    { id: "9100000000002", Account_Name: "Brightsteel Engineering" },
    { id: "9100000000003", Account_Name: "Northern Laser Cutting" },
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
  return { contacts, accounts, nextId: 9200000000100 };
}

export function org(): Org {
  g.__biginMockOrg ??= seedOrg();
  return g.__biginMockOrg;
}

/** 404 when the mock is off, 401 without a Zoho-style auth header — the same order the real API checks in. */
export function guard(request: Request): NextResponse | null {
  if (!mockBaseUrl()) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!request.headers.get("authorization")?.startsWith("Zoho-oauthtoken ")) {
    return NextResponse.json({ code: "INVALID_TOKEN", message: "invalid oauth token", status: "error" }, { status: 401 });
  }
  return null;
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
