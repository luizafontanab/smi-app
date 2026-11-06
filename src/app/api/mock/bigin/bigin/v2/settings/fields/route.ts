import { NextResponse, type NextRequest } from "next/server";
import { guard, org } from "../../../../store";

/**
 * Fake Bigin `GET /bigin/v2/settings/fields?module=Accounts` — the Companies
 * field list (issue #54). `module` is required, as Bigin's field-meta docs say.
 *
 * `org().refuseFieldList` makes it answer like a token without
 * ZohoBigin.settings.fields.READ. Bigin's docs name OAUTH_SCOPE_MISMATCH but
 * give no status; 401 with a top-level body is Zoho CRM's documented answer,
 * assumed the same here until a live account shows otherwise.
 */
export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const o = org();
  if (o.refuseFieldList) {
    return NextResponse.json({ code: "OAUTH_SCOPE_MISMATCH", details: {}, message: "invalid oauth scope to access this URL", status: "error" }, { status: 401 });
  }
  const moduleName = request.nextUrl.searchParams.get("module");
  if (!moduleName) return NextResponse.json({ code: "REQUIRED_PARAM_MISSING", details: { param: "module" }, message: "module is required", status: "error" }, { status: 400 });
  if (moduleName !== "Accounts") return NextResponse.json({ code: "INVALID_MODULE", details: {}, message: "the module name given seems to be invalid", status: "error" }, { status: 400 });
  return NextResponse.json({ fields: o.accountFields });
}
