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

/**
 * A member may carry several membership types — equipment seller and
 * subcontractor, say — but no more than six (USE-CASES gap 21, REQUIREMENTS §6,
 * 18 Sep). There are five today, so an honest form cannot exceed it; the cap is
 * enforced here because every write path is POST-reachable and the vocabulary
 * can grow. Not a DB constraint: a check constraint cannot count rows, and this
 * repo has no triggers.
 */
export const MAX_MEMBERSHIP_TYPES = 6;

/** The `membership_types` checkboxes every form posts, de-duplicated. */
export function membershipTypeIdsFromForm(formData: FormData): number[] {
  return [...new Set(formData.getAll("membership_types").map(Number).filter(Boolean))];
}

/** A readable refusal for a form, or null when `ids` is within the cap. */
export function membershipTypesError(ids: number[]): string | null {
  return ids.length > MAX_MEMBERSHIP_TYPES ? `Choose up to ${MAX_MEMBERSHIP_TYPES} membership types.` : null;
}

/**
 * Replace a member's `member_membership_types` rows with exactly `ids` — the
 * same delete-then-insert shape as replaceMemberServices, for the same reasons.
 * Three callers: the console editor, a draft member's own save, and approving
 * a live member's revision (`membership_type_ids` rides that payload the way
 * `service_ids` does). Throws past the cap rather than truncating, so a
 * tampered POST never silently loses the member's choice.
 */
export async function replaceMemberMembershipTypes(db: Db, memberId: string, ids: number[]) {
  const unique = [...new Set(ids)];
  const tooMany = membershipTypesError(unique);
  if (tooMany) throw new Error(tooMany);
  const { error } = await db.from("member_membership_types").delete().eq("member_id", memberId);
  if (error) throw error;
  if (!unique.length) return;
  const { error: insertError } = await db
    .from("member_membership_types")
    .insert(unique.map((membership_type_id) => ({ member_id: memberId, membership_type_id })));
  if (insertError) throw insertError;
}
