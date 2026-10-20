import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { currentUser } from "@/lib/auth";
import { sessionDb } from "@/lib/db/server";

/**
 * Landing point for the links in the "confirm your email change" emails
 * (GAPS A4.12). Same shape as /reset/confirm, for the same reasons: verifying
 * a token sets session cookies, which only a route handler can do, and both
 * token forms are accepted — `token_hash` works on any device, `code` (PKCE)
 * only in the browser that asked.
 *
 * With secure email change on, the member gets two emails — one to the old
 * address, one to the new — and the change applies only once both links are
 * clicked. This route cannot tell which of the two it is landing, or whether
 * the other has been clicked yet, so the page it hands off to says both.
 *
 * Deliberately outside /dashboard: the old address's email is often opened on
 * a phone with no session, and the proxy would bounce that to /login.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const failed = new URL("/login?error=email-change", request.url);
  const db = await sessionDb();

  if (tokenHash) {
    // Hardcoded, never taken from the query string, so this route can't be
    // used to verify an unrelated OTP purpose (signup, recovery, magic link).
    const { error } = await db.auth.verifyOtp({ type: "email_change", token_hash: tokenHash });
    if (error) return NextResponse.redirect(failed);
  } else if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(failed);
  } else {
    return NextResponse.redirect(failed);
  }

  // One row per link clicked: with secure email change there are two, and the
  // change applies only after both, so this records a confirmation, not the switch.
  const user = await currentUser();
  if (user) await audit({ action: "login_email_change_confirmed", actorUserId: user.userId, actorRole: user.role, memberId: user.memberId });
  return NextResponse.redirect(new URL("/dashboard/settings/security?econfirmed=1", request.url));
}
