import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function toLogin(request: NextRequest, next: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/**
 * Session refresh on every route (the public header reads the session too, and
 * an unrefreshed token would render it logged-out) + route gating for /console
 * and /member. Role-level authorization happens again inside layouts/actions —
 * this is only the outer gate.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // NB: not startsWith("/member") — that also swallows the public /members
  // directory and redirects anonymous visitors to /login.
  const needsAuth =
    pathname.startsWith("/console") || pathname === "/member" || pathname.startsWith("/member/");

  // No Supabase cookie: nothing to refresh, so anonymous traffic — the bulk of
  // the public site — skips the auth round-trip entirely.
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) {
    return needsAuth ? toLogin(request, pathname) : NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) => {
          all.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Gated routes need a verified identity, so they pay for getUser() — it always
  // calls the auth server. Public routes only need the cookie kept fresh, and
  // getSession() goes over the wire solely when the token is actually expiring;
  // using getUser() here put a /auth/v1/user round-trip on every public page view
  // and timed the local GoTrue container out under e2e load.
  if (needsAuth) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return toLogin(request, pathname);
  } else {
    await supabase.auth.getSession();
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
