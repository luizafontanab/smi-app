import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { serviceDb } from "./db/server";

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

/** `settings` key holding the design every visitor gets by default (GAPS A8.2). */
export const SITE_VARIANT_KEY = "site_variant";

export function isVariant(value: unknown): value is Variant {
  return value === "forge" || value === "grid";
}

/**
 * The site-wide design, set from the console (A28: switch the live site
 * between the two builds, immediately, no redeploy). Grid when unset — grid is
 * the default design — and grid when the read fails: a settings hiccup must
 * never take the public site down, and falling back to the default keeps a
 * blip from flipping the design under visitors.
 *
 * serviceDb because `settings` has RLS with no policies. Request-scoped via
 * cache(), so a render reads it at most once and a console change applies to
 * the very next request.
 */
export const defaultVariant = cache(async (): Promise<Variant> => {
  try {
    const { data } = await serviceDb().from("settings").select("value").eq("key", SITE_VARIANT_KEY).maybeSingle();
    return isVariant(data?.value) ? data.value : "grid";
  } catch {
    return "grid";
  }
});

/**
 * Request-scoped. cache() dedupes the read across the root layout, the page and
 * any view within one render — it does NOT cache across requests. Same pattern
 * as currentUser() in lib/auth.ts.
 *
 * A browser's own `smi-theme` cookie wins — that is the admin switcher, which
 * previews the other design without changing what anyone else sees. With no
 * cookie, or an unrecognised one (browsers still holding the retired
 * "live"/"demo" values), the request gets the site-wide default.
 *
 * Reading a cookie does not change a route's render mode here: the root layout
 * calls this on every request to stamp data-theme, so every route under it is
 * request-rendered anyway.
 */
export const siteVariant = cache(async (): Promise<Variant> => {
  const chosen = (await cookies()).get(VARIANT_COOKIE)?.value;
  return isVariant(chosen) ? chosen : defaultVariant();
});

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
