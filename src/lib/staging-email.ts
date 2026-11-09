import { serviceDb } from "./db/server";
import { logError } from "./log";

/**
 * Who staging may email: admins only (see adminsOnlyEmail in adapters/email).
 * Kept apart from the adapter so the adapter stays free of database imports.
 */

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; emails: Set<string> } | null = null;

/** Lower-cased login emails of every admin, plus the ADMIN_EMAIL inbox. Cached for a few minutes per server instance. */
export async function adminEmails(now = Date.now()): Promise<Set<string>> {
  if (cached && now - cached.at < CACHE_MS) return cached.emails;
  const db = serviceDb();
  const { data: admins, error } = await db.from("profiles").select("user_id").eq("role", "admin");
  if (error) throw new Error(`staging email: reading admins: ${error.message}`);
  const emails = new Set<string>();
  const inbox = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (inbox) emails.add(inbox);
  for (const { user_id } of admins ?? []) {
    const { data } = await db.auth.admin.getUserById(user_id);
    const email = data?.user?.email?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  cached = { at: now, emails };
  return emails;
}

/**
 * The addresses in `to` (one, or several comma-separated) that may receive
 * email. Fails closed: if the admin list can't be read, nobody does.
 */
export async function allowedRecipients(to: string): Promise<string[]> {
  let admins: Set<string>;
  try {
    admins = await adminEmails();
  } catch (e) {
    logError({ source: "server", area: "email:staging_admins", error: e });
    return [];
  }
  return to
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      const angled = /<([^>]+)>/.exec(part);
      return admins.has((angled ? angled[1] : part).trim().toLowerCase());
    });
}

/** For tests. */
export function resetAdminEmailCache() {
  cached = null;
}
