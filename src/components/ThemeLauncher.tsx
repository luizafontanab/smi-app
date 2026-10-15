import { cookies } from "next/headers";
import { currentUser, isAdmin } from "@/lib/auth";
import { THEME_SWITCHER_ENABLED } from "@/lib/theme-switcher-flag";
import { FloatingThemeSwitcher } from "./FloatingThemeSwitcher";

/**
 * Server gate for the floating design switcher, rendered from the root layout
 * on every route. Same shape as DevTaskLauncher, and for the same reason: not a
 * client component, so a possibly-anonymous visitor never even receives the
 * widget's JS.
 *
 * Running alongside DevTaskLauncher's identical gate costs one extra cookie
 * read and no second auth round-trip — currentUser() is cache()-wrapped and
 * request-scoped. Left as a duplicated four-line gate rather than factored into
 * a shared helper, which would mean editing DevTaskLauncher and the auth mock in
 * its test.
 *
 * global-error.tsx replaces the root layout on a full app crash, so the
 * switcher is absent there.
 */
export async function ThemeLauncher() {
  if (!THEME_SWITCHER_ENABLED) return null;
  // Cheap pre-test before touching auth: no sb-* cookie means certainly logged
  // out. Same reasoning as DevTaskLauncher — this runs on every public page
  // view, and proxy.ts avoids the GoTrue /auth/v1/user round-trip for
  // cookie-less visitors for exactly this reason.
  const store = await cookies();
  if (!store.getAll().some((c) => c.name.startsWith("sb-"))) return null;
  const user = await currentUser();
  if (!isAdmin(user)) return null;
  // No props: the switcher reads the current design off <html data-theme>,
  // which the root layout has already stamped.
  return <FloatingThemeSwitcher />;
}
