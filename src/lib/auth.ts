import { cache } from "react";
import { redirect } from "next/navigation";
import { sessionDb, serviceDb } from "./db/server";
import type { Database } from "./db/types";
import { memberLogins } from "./member-logins";
import { readOnlyBounce, viewAsCookie } from "./view-as";

/** Two roles, by design: admins are provisioned directly in the database; members are created by the join funnel and console's createMember. */
export type Role = Database["public"]["Enums"]["user_role"];

export type CurrentUser = {
  userId: string;
  email: string;
  role: Role;
  memberId: string | null;
  displayName: string | null;
};

/** Request-scoped cache: the public layout and JoinCta both call this per render. */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const db = await sessionDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data: profile } = await serviceDb()
    .from("profiles")
    .select("role, member_id, display_name")
    .eq("user_id", user.id)
    .single();
  if (!profile) return null;
  return {
    userId: user.id,
    email: user.email ?? "",
    role: profile.role,
    memberId: profile.member_id,
    displayName: profile.display_name,
  };
});

/** Console access; returns the user or redirects. Call in every console page/action. */
export async function requireConsole(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/console");
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

/** Admin-only surface: the dev-task widget, rendered for a possibly-anonymous visitor on any route. */
export function isAdmin(user: CurrentUser | null): boolean {
  return user?.role === "admin";
}

/**
 * Member actions — every "use server" export in the member area. Only a member
 * gets through. An admin viewing as a member (lib/view-as) is refused like any
 * other admin, just bounced back to the page they were on with `?readonly=1`
 * instead of to the console: view-as is read-only by construction, so a
 * member action that forgets about it still refuses.
 */
export async function requireMember(): Promise<CurrentUser & { memberId: string }> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");
  if (user.role === "member" && user.memberId) return user as CurrentUser & { memberId: string };
  if (user.role === "admin" && (await viewAsCookie())) redirect(await readOnlyBounce());
  redirect("/console");
}

/**
 * What a member-area page renders for. Deliberately not a CurrentUser: an
 * admin viewing as a member gets the member's id and login email, and nothing
 * here can be passed on to role checks (isAdmin, accountLinks, uploadOwnerFor)
 * as if it were the signed-in account.
 */
export type MemberView = {
  memberId: string;
  /** The member's login email — theirs even when an admin is viewing. */
  email: string;
  /** Set only for an admin viewing as this member. */
  viewingAs: { adminUserId: string; adminName: string | null } | null;
};

/**
 * Member-area pages and layouts ONLY — never a server action (enforced by
 * tests/unit/view-as-wiring.test.ts). A member sees their own data and any
 * view-as cookie they carry is ignored; an admin with a view-as cookie sees
 * that member's. Request-scoped like currentUser(), so the layout and page
 * share one lookup.
 */
export const requireMemberView = cache(async (): Promise<MemberView> => {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");
  if (user.role === "member" && user.memberId) {
    return { memberId: user.memberId, email: user.email, viewingAs: null };
  }
  const memberId = user.role === "admin" ? await viewAsCookie() : null;
  if (!memberId) redirect("/console");
  const { data: member } = await serviceDb().from("members").select("id").eq("id", memberId).maybeSingle();
  // Deleted since Jas started viewing it — back to the list rather than an empty dashboard.
  if (!member) redirect("/console/members");
  const [login] = await memberLogins(memberId);
  return {
    memberId,
    email: login?.email ?? "",
    viewingAs: { adminUserId: user.userId, adminName: user.displayName },
  };
});
