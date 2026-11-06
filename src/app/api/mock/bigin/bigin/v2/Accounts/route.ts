import { NextResponse, type NextRequest } from "next/server";
import { guard, org } from "../../../store";

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
    for (const f of fields) if (f in a) row[f] = a[f];
    return row;
  });
  if (!data.length) return new NextResponse(null, { status: 204 });
  return NextResponse.json({
    data,
    info: { count: data.length, page, per_page: perPage, more_records: page * perPage < all.length, next_page_token: null },
  });
}
