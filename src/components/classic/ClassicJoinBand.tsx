"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** The two pages that already ask a visitor to join (spec #68 story 17). */
const JOIN_PATHS = new Set(["/join", "/join/account"]);

/**
 * Classic's orange "Become a Member." band above the footer (#72). It reads the
 * path itself, so the hook point keeps its zero-prop shape, and drops out on
 * the join pages. Exact paths only, a trailing slash aside: `/joinery` and any
 * deeper `/join/…` page keep the band.
 *
 * Shown to signed-in members too: the spec hides it by path only, and knowing
 * the user would need a prop the layout doesn't pass.
 *
 * The copy is Current's JoinCta line, not new wording.
 */
export function ClassicJoinBand() {
  const path = (usePathname() ?? "/").replace(/\/+$/, "") || "/";
  if (JOIN_PATHS.has(path)) return null;
  return (
    <section data-part="site-footer-join" aria-labelledby="site-footer-join-title">
      <h2 id="site-footer-join-title" data-part="site-footer-join-title">Become a Member.</h2>
      <p data-part="site-footer-join-intro">
        A member page, your news on our channels, and analytics showing which companies are looking at you — £40/month.
      </p>
      <Link data-part="site-footer-join-button" href="/join">Become a Member</Link>
    </section>
  );
}
