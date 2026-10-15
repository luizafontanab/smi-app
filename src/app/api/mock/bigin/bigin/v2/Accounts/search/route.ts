import { NextResponse, type NextRequest } from "next/server";
import { equalsCriterion, guard, org } from "../../../../store";

/** Fake Bigin `GET /bigin/v2/Accounts/search` — exact `(Account_Name:equals:…)` or a `word=` substring. */
export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const sp = request.nextUrl.searchParams;
  const exact = equalsCriterion(sp.get("criteria"), "Account_Name");
  const word = sp.get("word")?.toLowerCase();
  const data = org().accounts.filter((a) =>
    exact !== null ? a.Account_Name.toLowerCase() === exact.toLowerCase() : !!word && a.Account_Name.toLowerCase().includes(word),
  );
  if (!data.length) return new NextResponse(null, { status: 204 });
  return NextResponse.json({ data, info: { count: data.length, more_records: false } });
}
