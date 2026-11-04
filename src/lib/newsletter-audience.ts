import "server-only";
import type { serviceDb } from "./db/server";

type Db = ReturnType<typeof serviceDb>;

/**
 * Who a newsletter issue would go to right now: subscribed, never unsubscribed
 * and not bounced, as the sender counts them. A head-only count query — await
 * it for `{ count, error }`, or hand it to mustList() to throw on failure.
 *
 * One definition for every place that shows or records the audience (the
 * composer, an issue's approval, /console/social-reach), so they can never
 * disagree. Lives here rather than in console/actions.ts because an export from
 * a "use server" module becomes a callable server action.
 */
export function newsletterAudience(db: Db) {
  return db.from("contacts").select("*", { count: "exact", head: true }).eq("subscribed", true).is("unsubscribed_at", null).is("bounced_at", null);
}
