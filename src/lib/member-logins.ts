import { serviceDb } from "./db/server";
import { logError } from "./log";

export type MemberLogin = { userId: string; email: string | null; lastSignInAt: string | null };

/**
 * The logins attached to one member company, oldest first, with each one's
 * email and last sign-in from Supabase Auth. Phase 1 is one shared login per
 * company, but profiles.member_id isn't unique, so this is a list.
 *
 * `last_sign_in_at` moves only on a real sign-in, not on a session refresh: a
 * member who stays logged in shows an older date. Read it as "last sign-in",
 * never "last seen".
 *
 * A failed Auth lookup keeps the login with nulls rather than dropping it —
 * the console still shows the login exists.
 */
export async function memberLogins(memberId: string): Promise<MemberLogin[]> {
  const db = serviceDb();
  const { data: profiles } = await db
    .from("profiles")
    .select("user_id")
    .eq("member_id", memberId)
    .order("created_at", { ascending: true });
  return Promise.all(
    (profiles ?? []).map(async ({ user_id }) => {
      const { data, error } = await db.auth.admin.getUserById(user_id);
      if (error || !data?.user) {
        logError({ source: "server", area: "member-logins:get-user", error: error ?? new Error("getUserById returned no user") });
        return { userId: user_id, email: null, lastSignInAt: null };
      }
      return { userId: user_id, email: data.user.email ?? null, lastSignInAt: data.user.last_sign_in_at ?? null };
    }),
  );
}
