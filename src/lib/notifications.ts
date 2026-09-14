import { serviceDb } from "@/lib/db/server";

/**
 * Member notification read helpers.
 *
 * Own module rather than `queries.ts` on purpose: everything in there goes
 * through `publicDb()` so RLS is exercised on anonymous read paths, whereas a
 * notification is member-private. Same shape as `lib/submissions.ts` —
 * `serviceDb()` plus an explicit `member_id` filter, which is the ownership
 * check. There *is* a `member_read_own_notifications` RLS policy
 * (20260808000004), but the dashboard already reads this table with the service
 * role, and one access pattern is easier to reason about than two.
 */
export async function unreadNotificationCount(memberId: string): Promise<number> {
  const { count } = await serviceDb()
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("member_id", memberId)
    .is("read_at", null);
  return count ?? 0;
}
