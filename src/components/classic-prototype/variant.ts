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

export async function classicVariant(): Promise<ClassicVariant> {
  const v = (await cookies()).get("classic-proto")?.value;
  return (CLASSIC_VARIANTS as readonly string[]).includes(v ?? "") ? (v as ClassicVariant) : "current";
}
