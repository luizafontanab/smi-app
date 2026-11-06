import "server-only";
import { cookies } from "next/headers";

/*
 * PROTOTYPE — issue #59 "How close to the live site should Classic look?".
 * Throwaway, lives only on the prototype-classic branch. Never merge.
 *
 * Three points on a fidelity scale, plus Current for comparison, switchable
 * via ?variant= on / and /news/[slug] (the proxy turns it into a cookie so it
 * survives clicking from the homepage into a story):
 *   current  staging's grid, untouched
 *   A        Faithful: live-site look throughout
 *   B        Adapted: live palette + chrome on our layouts
 *   C        Chrome only: live header/footer on today's pages
 */
export const CLASSIC_VARIANTS = ["current", "A", "B", "C"] as const;
export type ClassicVariant = (typeof CLASSIC_VARIANTS)[number];

export const VARIANT_NAMES: Record<ClassicVariant, string> = {
  current: "Current (staging)",
  A: "Faithful",
  B: "Adapted",
  C: "Header + footer only",
};

/*
 * Issue #63 adds page-level variants A2 / A3 for /industry/[slug],
 * /newsletters/[slug] and /join (see pageVariants.ts). They keep variant A's
 * Faithful chrome, so the layout sees "A" for them.
 */
export async function rawClassicVariant(): Promise<string> {
  return (await cookies()).get("classic-proto")?.value ?? "current";
}

export async function classicVariant(): Promise<ClassicVariant> {
  const v = await rawClassicVariant();
  if (v === "A2" || v === "A3") return "A";
  return (CLASSIC_VARIANTS as readonly string[]).includes(v) ? (v as ClassicVariant) : "current";
}

/** Issue #63: which page variant a no-live-counterpart page renders. */
export async function pageVariant(): Promise<"current" | "A" | "A2" | "A3"> {
  const v = await rawClassicVariant();
  return v === "A2" || v === "A3" || v === "A" ? v : "current";
}
