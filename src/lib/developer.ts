import "server-only";
import { notFound } from "next/navigation";
import { requireConsole, type CurrentUser } from "./auth";

/**
 * Developer-only surfaces (the error log, docs/logging.md). There is no
 * developer role — Jas and the developer are both `admin` — so this is an
 * email allowlist, DEVELOPER_EMAILS, comma-separated. Unset means nobody:
 * the safe default for a page that shows stack traces.
 */
export function developerEmails(): Set<string> {
  return new Set(
    (process.env.DEVELOPER_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isDeveloper(user: CurrentUser | null): boolean {
  return Boolean(user && user.role === "admin" && user.email && developerEmails().has(user.email.toLowerCase()));
}

/**
 * For developer pages and actions. An admin who isn't a developer gets a 404,
 * not a redirect — the console shouldn't advertise that the page exists.
 */
export async function requireDeveloper(): Promise<CurrentUser> {
  const user = await requireConsole();
  if (!isDeveloper(user)) notFound();
  return user;
}
