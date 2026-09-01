/**
 * The cookie CookieConsent.tsx writes and analytics.ts reads. Its own module,
 * not re-declared in analytics.ts, so it can be imported into client
 * components too — analytics.ts pulls in next/headers at module scope, which
 * a client bundle can't carry.
 */
export const CONSENT_COOKIE = "smi-consent";
