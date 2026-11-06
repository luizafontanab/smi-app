import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNTS_UPDATE_SCOPE, guard, org, requireScope, success } from "../../../store";

/** Fake Bigin `GET /bigin/v2/Accounts` — page/per_page paging, the named `fields` plus id. */
export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const perPage = Math.min(Number(sp.get("per_page") ?? 200) || 200, 200);
  const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
  const fields = (sp.get("fields") ?? "").split(",").filter(Boolean);
  const all = org().accounts;
  const data = all.slice((page - 1) * perPage, page * perPage).map((a) => {
    const row: Record<string, unknown> = { id: a.id };
    for (const f of fields) if (f in a) row[f] = a[f as keyof typeof a];
    return row;
  });
  if (!data.length) return new NextResponse(null, { status: 204 });
  return NextResponse.json({
    data,
    info: { count: data.length, page, per_page: perPage, more_records: page * perPage < all.length, next_page_token: null },
  });
}

/**
 * Fake Bigin `PUT /bigin/v2/Accounts` — the bulk update form, the one Bigin's
 * update-records docs give a sample of: `{ data: [{ id, ...fields }] }`,
 * answered per record. Any field the company already has is applied (the
 * app only writes the News Page URL, issue #55); a blank value clears it.
 * Needs the Companies update scope.
 *
 * An empty `data` is a validation error, not a scope one — which is how the
 * adapter's canWriteCompanies() checks the scope without changing anything.
 */
export async function PUT(request: NextRequest) {
  const denied = guard(request) ?? requireScope(ACCOUNTS_UPDATE_SCOPE);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
  const items = body.data ?? [];
  if (!items.length) {
    return NextResponse.json({ code: "MANDATORY_NOT_FOUND", details: { api_name: "data" }, message: "required field not found", status: "error" }, { status: 400 });
  }
  const results = items.map((item) => {
    const account = org().accounts.find((a) => a.id === item.id);
    if (!account) return { code: "INVALID_DATA", details: { id: item.id }, message: "the id given seems to be invalid", status: "error" };
    const fields = account as Record<string, unknown>;
    for (const [key, value] of Object.entries(item)) {
      if (key !== "id" && key in fields) fields[key] = value === "" ? null : value;
    }
    return success(account.id, "record updated");
  });
  const failed = results.every((r) => r.code !== "SUCCESS");
  return NextResponse.json({ data: results }, { status: failed ? 400 : 200 });
}
