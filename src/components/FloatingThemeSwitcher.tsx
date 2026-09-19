"use client";

import { useId, useState } from "react";
import { usePathname } from "next/navigation";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

/**
 * The design switcher, floating over every route for admins only (gated by
 * ThemeLauncher). The two designs change the whole public chrome, not just the
 * homepage, so the control has to be reachable from the page being judged
 * rather than only from the console header.
 *
 * Collapsed to a chip by default: this sits on top of the very design it
 * switches, so it stays out of the way until asked for.
 *
 * ThemeSwitcher is reused as-is — its classes assume dark chrome behind them
 * (border-white/20, text-white/70, hover:bg-chrome-hover), which is exactly
 * what the bg-chrome backing below provides. No new prop, no fork.
 */
export function FloatingThemeSwitcher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // The console header already carries a ThemeSwitcher; a second one floating
  // over it would be a duplicate control for the same cookie.
  //
  // usePathname() rather than window.location: it re-renders on client-side
  // navigation, so stepping from /news into /console actually hides this. It
  // needs no Suspense boundary here — that is only required under
  // `cacheComponents`, which next.config.ts does not enable (see
  // next/dist/docs/01-app/03-api-reference/04-functions/use-pathname.md), and
  // the hydration-mismatch caveat in those docs is about rewrites, of which
  // this app has none (next.config.ts has redirects; proxy.ts only redirects).
  // client-context.ts states a blanket "no usePathname()" for root-layout
  // widgets — its Suspense concern is useSearchParams, and it simply had no
  // need for the pathname.
  //
  // Optional chaining is deliberate: the return type admits null, and failing
  // open is better than crashing a widget that renders on every route.
  if (pathname?.startsWith("/console")) return null;

  return (
    <div className="fixed bottom-20 left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 print:hidden">
      {/* Matches the Feedback button's treatment (dev-task/DevTaskWidget.tsx),
          which owns the opposite corner. z-50 is the established ceiling for
          fixed chrome here; this is not a modal, so it needs no <dialog>.

          bottom-20 rather than bottom-4, and this is load-bearing: Next's
          dev-tools indicator is anchored bottom-left in development (measured
          at 20,944 96x36 in a 1280x1000 viewport) and renders in a portal above
          everything, so a chip at bottom-4 left-4 is literally unclickable
          while `next dev` is running — which is exactly when this control gets
          used. Clearing it vertically rather than horizontally because that
          badge grows sideways as it accumulates issues ("N 1 Issue"). It also
          lifts the chip clear of a one-line CookieConsent banner. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="tap rounded-full bg-chrome px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-chrome-hover"
      >
        Theme
      </button>
      {/* Kept mounted and hidden rather than conditionally rendered, so
          aria-controls always resolves to a real element — pointing it at an
          id that isn't in the document is an authoring error. The hidden
          attribute is safe against any display utility landing here later:
          Tailwind's preflight makes it `display: none !important`. Focus is
          deliberately not moved on expand — this is a disclosure, not a modal,
          and the buttons inside are the next thing in DOM order anyway. */}
      <div
        id={panelId}
        hidden={!open}
        role="group"
        aria-label="Theme"
        className="rounded-full bg-chrome px-3 py-2 shadow-lg"
      >
        <ThemeSwitcher compact />
      </div>
    </div>
  );
}
