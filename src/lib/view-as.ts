import { cookies, headers } from "next/headers";
import { UUID_RE } from "./validate";

/**
 * "View as member" (fix-list 94): an admin opens a member's real /dashboard,
 * read-only. The cookie only names which member; it carries no authority of
 * its own. lib/auth honours it for an admin and ignores it for anyone else, so
 * it needs no signing — an admin can already read every member, and a member
 * who forges one still sees only their own data.
 *
 * Kept apart from lib/auth so it can be imported by the actions that set it
 * without pulling auth into a cycle.
 */
export const VIEW_AS_COOKIE = "smi-view-as";

/** A working session's worth; Exit and sign-out clear it sooner. */
export const VIEW_AS_MAX_AGE = 60 * 60 * 8;

export function viewAsCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: VIEW_AS_MAX_AGE,
  };
}

/** The member id in the cookie when it is well-formed, else null. Says nothing about who is asking. */
export async function viewAsCookie(): Promise<string | null> {
  const value = (await cookies()).get(VIEW_AS_COOKIE)?.value ?? "";
  return UUID_RE.test(value) ? value : null;
}

/**
 * Where a refused member action sends an admin who is viewing as a member: the
 * dashboard page they were on, flagged `readonly=1` so the banner can say
 * nothing was saved. Only the Referer's path is used, and only a /dashboard
 * one — never its origin — so the bounce can't be pointed off-site.
 */
export async function readOnlyBounce(): Promise<string> {
  const fallback = "/dashboard?readonly=1";
  const referer = (await headers()).get("referer");
  if (!referer) return fallback;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return fallback;
  }
  if (url.pathname !== "/dashboard" && !url.pathname.startsWith("/dashboard/")) return fallback;
  url.searchParams.set("readonly", "1");
  return `${url.pathname}${url.search}`;
}
