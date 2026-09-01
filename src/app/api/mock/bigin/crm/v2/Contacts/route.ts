import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";

/** Fake Bigin `/crm/v2/Contacts` upsert — only live when `mockBaseUrl()` is set. */
export async function POST(request: NextRequest) {
  if (!mockBaseUrl()) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!request.headers.get("authorization")?.startsWith("Zoho-oauthtoken ")) {
    return NextResponse.json({ code: "INVALID_TOKEN", message: "invalid oauth token" }, { status: 401 });
  }
  return NextResponse.json({
    data: [{ code: "SUCCESS", details: { id: `mock-${randomUUID()}` }, status: "success" }],
  });
}
