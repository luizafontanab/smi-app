import type { serviceDb } from "@/lib/db/server";

type Db = ReturnType<typeof serviceDb>;

/**
 * Replace a member's `member_services` rows with exactly `serviceIds`.
 *
 * Delete-all-then-insert, the same shape the console already uses for
 * `member_membership_types` (console/actions.ts). It is not a transaction: a
 * failure between the two statements leaves the member with no services rather
 * than a half-merged set, which is the recoverable direction — the member simply
 * re-saves. A merge diff would be more code for a set that is at most a few
 * dozen rows.
 *
 * Shared because two call sites need identical behaviour: a draft member's
 * profile save (applies immediately) and the console approving a revision
 * (applies on approve). `service_ids` travels inside the revision payload
 * because services are a join table, not a `members` column.
 */
export async function replaceMemberServices(db: Db, memberId: string, serviceIds: number[]) {
  const { error } = await db.from("member_services").delete().eq("member_id", memberId);
  if (error) throw error;
  if (!serviceIds.length) return;
  const { error: insertError } = await db
    .from("member_services")
    .insert([...new Set(serviceIds)].map((service_id) => ({ member_id: memberId, service_id })));
  if (insertError) throw insertError;
}
