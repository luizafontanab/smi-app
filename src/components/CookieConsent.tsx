"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CONSENT_COOKIE } from "@/lib/consent";

export function CookieConsent() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(!document.cookie.includes(`${CONSENT_COOKIE}=`)), 0);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const choose = (v: "all" | "essential") => {
    document.cookie = `${CONSENT_COOKIE}=${v}; path=/; max-age=${60 * 60 * 24 * 365}`;
    setShow(false);
  };
  return (
    // A non-modal banner on purpose: no focus trap or focus steal — reading
    // must stay uninterrupted. The region role + label give screen readers a
    // way to find and name it from the landmark list.
    //
    // Sticky, not fixed (#33): it is the public layout's last child, so it
    // pins to the bottom of the screen while there is page below, but also
    // takes up its own room at the very end — the footer and a form's last
    // button can always be scrolled clear of it instead of hiding under it.
    <div role="region" aria-label="Cookie consent" data-part="cookie-banner" className="sticky inset-x-0 bottom-0 z-50 border-t bg-white p-4 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm">
        <p>
          We use cookies for anonymous readership stats that help our members see who&apos;s engaging.{" "}
          {/* The cookie policy is a section of the Policies page. */}
          <Link href="/pages/policies" className="font-semibold underline underline-offset-2">Cookie policy</Link>
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => choose("essential")} data-part="button-secondary" className="tap rounded border px-3 py-1.5">Essential only</button>
          <button type="button" onClick={() => choose("all")} data-part="button-primary" className="tap rounded bg-ink px-3 py-1.5 text-white">Accept</button>
        </div>
      </div>
    </div>
  );
}
