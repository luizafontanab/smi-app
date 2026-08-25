import { cache } from "react";
import { redirect } from "next/navigation";
import { sessionDb, serviceDb } from "./db/server";

export type Role = "super_admin" | "approver" | "viewer" | "input_only" | "member";

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
    role: profile.role as Role,
    memberId: profile.member_id,
    displayName: profile.display_name,
  };
});

const CONSOLE_ROLES: Role[] = ["super_admin", "approver", "viewer", "input_only"];

/** Console access; returns the user or redirects. Call in every console page/action. */
export async function requireConsole(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/console");
  if (!CONSOLE_ROLES.includes(user.role)) redirect("/dashboard");
  return user;
}

/** Mutating console actions: viewer can't write; input_only can only create draft stories. */
export function canWrite(user: CurrentUser): boolean {
  return user.role === "super_admin" || user.role === "approver";
}
export function canApprove(user: CurrentUser): boolean {
  return user.role === "super_admin" || user.role === "approver";
}

export async function requireMember(): Promise<CurrentUser & { memberId: string }> {
  const user = await currentUser();
  if (!user) redirect("/login?next=/dashboard");
  if (user.role !== "member" || !user.memberId) redirect("/console");
  return user as CurrentUser & { memberId: string };
}
