import { NextResponse, type NextRequest } from "next/server";
import { applyWrite, guard, org, success, type MockContact } from "../../../store";

/** Fake Bigin `GET /bigin/v2/Contacts` — newest-modified first, page/per_page paging. */
export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const perPage = Math.min(Number(sp.get("per_page") ?? 200) || 200, 200);
  const page = Math.max(Number(sp.get("page") ?? 1) || 1, 1);
  const all = [...org().contacts.values()].sort((a, b) => b.Modified_Time.localeCompare(a.Modified_Time));
  const data = all.slice((page - 1) * perPage, page * perPage);
  if (!data.length) return new NextResponse(null, { status: 204 });
  return NextResponse.json({
    data,
    info: { count: data.length, page, per_page: perPage, more_records: page * perPage < all.length, next_page_token: null },
  });
}

/** Fake Bigin `POST /bigin/v2/Contacts` — insert. */
export async function POST(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { data?: Record<string, unknown>[] };
  const store = org();
  const results = (body.data ?? []).map((data) => {
    if (typeof data.Last_Name !== "string" || !data.Last_Name) {
      return { code: "MANDATORY_NOT_FOUND", details: { api_name: "Last_Name" }, message: "required field not found", status: "error" };
    }
    const id = String(store.nextId++);
    const blank: MockContact = {
      id, Email: null, First_Name: null, Last_Name: "", Full_Name: "", Account_Name: null,
      Email_Opt_Out: false, Unsubscribed_Time: null, Modified_Time: new Date().toISOString(),
    };
    store.contacts.set(id, applyWrite(blank, data));
    return success(id, "record added");
  });
  const ok = results.every((r) => r.code === "SUCCESS");
  return NextResponse.json({ data: results }, { status: ok ? 201 : 202 });
}
