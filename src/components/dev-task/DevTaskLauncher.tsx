import { cookies } from "next/headers";
import { currentUser, isAdmin } from "@/lib/auth";
import { DevTaskWidget } from "./DevTaskWidget";

/**
 * Server gate for the floating "Report a bug" button, rendered from the root
 * layout on every route. Not a client component: a possibly-anonymous
 * visitor must never even receive the widget's JS if they can't use it.
 *
 * global-error.tsx replaces the root layout on a full app crash, so the
 * widget is absent there — the one error you most want reported cannot be
 * reported from that screen.
 */
export async function DevTaskLauncher() {
  // Cheap pre-test before touching auth: no sb-* cookie means certainly
  // logged out. proxy.ts avoids the GoTrue /auth/v1/user round-trip for
  // cookie-less visitors for the same reason (it timed the local container
  // out under e2e load) — the root layout must not put it back on every
  // page view.
  const store = await cookies();
  if (!store.getAll().some((c) => c.name.startsWith("sb-"))) return null;
  const user = await currentUser();
  if (!isAdmin(user)) return null;
  return <DevTaskWidget reporterName={user!.displayName ?? user!.email} />;
}
