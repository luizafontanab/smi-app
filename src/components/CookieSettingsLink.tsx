"use client";

import { CONSENT_COOKIE } from "@/lib/consent";

/** Expires the consent cookie and reloads — CookieConsent's own mount check re-shows the banner. */
export function CookieSettingsLink() {
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${CONSENT_COOKIE}=; path=/; max-age=0`;
        window.location.reload();
      }}
      className="hover:text-brand"
    >
      Cookie settings
    </button>
  );
}
