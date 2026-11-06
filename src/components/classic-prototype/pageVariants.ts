/*
 * PROTOTYPE — issue #63 "How do Classic's pages with no live counterpart
 * look?". Throwaway, prototype-classic branch only. Never merge.
 *
 * On /industry/[slug], /newsletters/[slug] and /join the switcher cycles
 * these instead of the #59 fidelity variants. All three A's wear variant A's
 * Faithful chrome; they differ in page structure:
 *   current  staging's grid, untouched
 *   A        the page as it is, Classic CSS only (what "no hook point" gives)
 *   A2 / A3  two structural takes, named per page below
 */
export const PAGE_VARIANTS = ["current", "A", "A2", "A3"] as const;

export function pageVariantNames(pathname: string): Record<string, string> | null {
  if (pathname.startsWith("/industry/"))
    return { current: "Current (staging)", A: "CSS only: stacked carousels", A2: "Topic page, like live /news/", A3: "Mini homepage: Newsroom + rows" };
  if (/^\/newsletters\/[^/]+/.test(pathname))
    return { current: "Current (staging)", A: "CSS only: email layout", A2: "Live Newsletters page shape", A3: "Article shape, numbered" };
  if (pathname === "/join")
    return { current: "Current (staging)", A: "CSS only: ours as it is", A2: "Live sales page", A3: "Hybrid: live banner, our content" };
  return null;
}
