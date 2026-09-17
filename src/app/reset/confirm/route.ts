import { NextResponse, type NextRequest } from "next/server";
import { sessionDb } from "@/lib/db/server";

/**
 * Landing point for the link in the recovery email. Exchanging the token has to
 * set session cookies, which a Server Component cannot do — hence a route
 * handler that establishes the session and then hands off to the form.
 *
 * Both token shapes are accepted on purpose:
 *  - `token_hash` (Supabase's `{{ .TokenHash }}` template variable) works from
 *    any device, because verification carries no browser state.
 *  - `code` (the default `{{ .ConfirmationURL }}` template) is PKCE and needs
 *    the verifier cookie, so it only works in the browser that asked.
 *
 * A member locked out of their account will very often open the email on their
 * phone, so the device-independent path is the one worth having — but the
 * default template ships `code`, and supporting both means this works before
 * anyone customises the template and after.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");

  const failed = new URL("/login?error=reset", request.url);
  const db = await sessionDb();

  if (tokenHash) {
    // This route only ever exists to land a password reset — hardcoded rather
    // than trusting the query string's own `type`, so it can't be used to
    // verify an unrelated OTP purpose (signup, email-change, magic link).
    const { error } = await db.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) return NextResponse.redirect(failed);
  } else if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failed);
  } else {
    return NextResponse.redirect(failed);
  }

  // Session established. The password form is a normal page from here.
  return NextResponse.redirect(new URL("/reset/new", request.url));
}
