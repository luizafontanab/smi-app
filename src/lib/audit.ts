import { headers } from "next/headers";
import { serviceDb } from "./db/server";
import type { Json } from "./db/types";
import { logError } from "./log";

/**
 * The security audit log (docs/GDPR.md §16 "A"; table `audit_events`, migration
 * 20261020000001). One purpose only: knowing who signed in, who changed
 * credentials, and who looked at or changed a member's record — to spot and
 * investigate unauthorised access. Not for sales or renewal calls (purpose
 * limitation, UK GDPR Art 5(1)(b)); usage for those is a separate, disclosed
 * record.
 *
 * Append-only: the app can insert and read, never edit or delete. Retention is
 * purge_audit_events(), run daily by the log_retention job.
 */
export type AuditAction =
  | "sign_in"
  | "sign_in_failed"
  | "sign_out"
  | "password_changed"
  | "password_reset"
  | "login_email_change_requested"
  | "login_email_change_confirmed"
  | "view_as_start"
  | "view_as_stop"
  | "member_created"
  | "member_updated"
  | "member_status_changed"
  | "member_payment_recorded"
  | "member_archived"
  | "member_unarchived"
  | "member_deleted";

/** The events whose IP is kept (90 days) — sign-in and credential changes, where it helps spot a stranger. */
const IP_ACTIONS = new Set<AuditAction>([
  "sign_in", "sign_in_failed", "password_changed", "password_reset", "login_email_change_requested", "login_email_change_confirmed",
]);

export type AuditEntry = {
  action: AuditAction;
  actorUserId?: string | null;
  actorRole?: "admin" | "member" | null;
  memberId?: string | null;
  /** Minimal context. `email` is only for a failed sign-in, and is stripped after 90 days with the IP. */
  detail?: Record<string, Json>;
};

/** "1.2.3.4" from x-forwarded-for's first entry (Vercel sets it), or null when there is none or it isn't an address. */
export async function requestIp(): Promise<string | null> {
  try {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    return /^[0-9a-f.:]+$/i.test(ip) && ip.length <= 45 ? ip : null;
  } catch {
    return null; // outside a request (jobs, tests without headers)
  }
}

/**
 * Record one event. Awaited, so the row lands before the caller redirects, but
 * it never throws: a log that fails must not fail the sign-in or save it
 * describes. A failed write goes to the error log instead.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const ip = IP_ACTIONS.has(entry.action) ? await requestIp() : null;
    const { error } = await serviceDb().from("audit_events").insert({
      action: entry.action,
      actor_user_id: entry.actorUserId ?? null,
      actor_role: entry.actorRole ?? null,
      member_id: entry.memberId ?? null,
      detail: entry.detail ?? {},
      ip,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    logError({ source: "server", area: `audit:${entry.action}`, error: e });
  }
}

export type AuditRow = { at: string; action: AuditAction; actorName: string | null; detail: Record<string, Json> };

/**
 * Admin access to one member — what Jas sees on the member's console page:
 * view-as sessions and console changes. The member's own sign-ins stay out of
 * it: they're security data, not a record of the member for renewal calls.
 */
export async function memberAdminAccess(memberId: string, limit = 20): Promise<AuditRow[]> {
  const db = serviceDb();
  const { data, error } = await db
    .from("audit_events")
    .select("at, action, actor_user_id, detail")
    .eq("member_id", memberId)
    .eq("actor_role", "admin")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) {
    logError({ source: "server", area: "audit:member-admin-access", error });
    return [];
  }
  // No foreign key (the log outlives accounts), so names are a second read; a
  // since-deleted admin shows as unknown rather than dropping the row.
  const actorIds = [...new Set((data ?? []).map((r) => r.actor_user_id).filter((v): v is string => !!v))];
  const { data: profiles } = actorIds.length
    ? await db.from("profiles").select("user_id, display_name").in("user_id", actorIds)
    : { data: [] as { user_id: string; display_name: string | null }[] };
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
  return (data ?? []).map((r) => ({
    at: r.at,
    action: r.action as AuditAction,
    actorName: (r.actor_user_id && names.get(r.actor_user_id)) || null,
    detail: (r.detail ?? {}) as Record<string, Json>,
  }));
}
