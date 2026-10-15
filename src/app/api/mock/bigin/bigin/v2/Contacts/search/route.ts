import { NextResponse, type NextRequest } from "next/server";
import { equalsCriterion, guard, org } from "../../../../store";

/** Fake Bigin `GET /bigin/v2/Contacts/search` — `(Email:equals:…)` criteria or `email=`. */
export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const email = (equalsCriterion(sp.get("criteria"), "Email") ?? sp.get("email") ?? "").toLowerCase();
  const data = email ? [...org().contacts.values()].filter((c) => c.Email?.toLowerCase() === email) : [];
  if (!data.length) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ data, info: { count: data.length, more_records: false } });
}
