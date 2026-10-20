"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { UUID_RE } from "@/lib/validate";
import { VIEW_AS_COOKIE, viewAsCookie, viewAsCookieOptions } from "@/lib/view-as";

/**
 * "View as member" (fix-list 94) — in and out. Its own segment rather than
 * console/actions.ts, so the dashboard layout's Exit button doesn't pull the
 * console's whole action graph into the member area.
 */

/** From /console/members/[id]: open that member's dashboard, read-only. */
export async function startViewAs(formData: FormData) {
  const admin = await requireConsole();
  const id = String(formData.get("member_id") ?? "");
  if (!UUID_RE.test(id)) redirect("/console/members");
  const { data: member } = await serviceDb().from("members").select("id").eq("id", id).maybeSingle();
  if (!member) redirect("/console/members");
  // Admin access to a member's data — the ICO's audit toolkit expects it recorded.
  await audit({ action: "view_as_start", actorUserId: admin.userId, actorRole: "admin", memberId: id });
  (await cookies()).set(VIEW_AS_COOKIE, id, viewAsCookieOptions());
  redirect("/dashboard");
}

/** The banner's "Back to console": forget the member and return to their console page. */
export async function stopViewAs() {
  const id = await viewAsCookie();
  // Cleared before the role check: whoever holds a stale cookie should lose it.
  (await cookies()).delete(VIEW_AS_COOKIE);
  const admin = await requireConsole();
  if (id) await audit({ action: "view_as_stop", actorUserId: admin.userId, actorRole: "admin", memberId: id });
  redirect(id ? `/console/members/${id}` : "/console/members");
}
