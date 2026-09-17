import { NextResponse } from "next/server";
import { mockBaseUrl } from "@/lib/adapters/mock-base-url";

/** Fake Zoho OAuth token exchange — only live when `mockBaseUrl()` is set. */
export async function POST() {
  if (!mockBaseUrl()) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ access_token: "mock-access-token", expires_in: 3600, token_type: "Bearer" });
}
