import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";

/**
 * Which of the two site designs this request is being rendered in.
 *
 * The designs differ structurally, not just in colour, so a route that genuinely
 * differs loads a view module per design and picks one with pickView(). A route
 * whose two designs are identical does not call this at all — it keeps its single
 * page.tsx and picks up the difference through tokens alone. Sharing is the
 * default; only split a route when there is a real structural difference.
 */

export const VARIANT_COOKIE = "smi-theme";

export type Variant = "forge" | "grid";

/**
 * Request-scoped. cache() dedupes the read across the root layout, the page and
 * any view within one render — it does NOT cache across requests. Same pattern
 * as currentUser() in lib/auth.ts.
 *
 * Anything unrecognised is forge, which is how browsers still holding the
 * retired "live"/"demo" cookie values migrate without being asked.
 *
 * Reading a cookie does not change a route's render mode here: the root layout
 * already calls cookies(), so every route under it is request-rendered anyway.
 */
export const siteVariant = cache(async (): Promise<Variant> =>
  (await cookies()).get(VARIANT_COOKIE)?.value === "grid" ? "grid" : "forge",
);

/**
 * Pick this request's view module. The registry is the object literal at the
 * call site, so there is no second routing table to keep in step:
 *
 *   const View = await pickView({ forge: ForgeHome, grid: GridHome });
 *   return <View {...data} />;
 */
export async function pickView<T>(views: Record<Variant, T>): Promise<T> {
  return views[await siteVariant()];
}
