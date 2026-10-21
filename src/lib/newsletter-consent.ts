/**
 * Consent evidence for the newsletter (gap review area 6; GDPR.md G9, Art 7(1)):
 * when, by which route and — for a site signup — against what wording a
 * contact went onto the list. Stored in contacts.opt_in_* (migration
 * 20261021000004).
 *
 * The signup forms' copy lives here, not in the components, so what a form
 * shows and what is recorded as shown can't drift apart: each surface renders
 * its heading and blurb from SIGNUP_SURFACES and posts its key, and the server
 * records that surface's wording. A form posting an unknown key (an old cached
 * page, a direct POST) is recorded as such rather than guessed.
 */

export type OptInSource = "site_form" | "console" | "bigin" | "mailchimp";

export const SIGNUP_SURFACES = {
  footer: { heading: "Monthly newsletter", blurb: null },
  grid_footer: { heading: "Monthly newsletter", blurb: "UK sheet metal news, machinery launches and event dates, for free." },
  page_block: { heading: "The monthly round-up, straight to your inbox", blurb: null },
  home_card: { heading: "Get the SMI newsletter", blurb: "UK sheet metal manufacturing news, machinery launches and event dates, for free." },
} as const satisfies Record<string, { heading: string; blurb: string | null }>;

export type SignupSurface = keyof typeof SIGNUP_SURFACES;

export const UNKNOWN_SURFACE_WORDING = "A newsletter signup form (which one wasn't recorded).";

export function isSignupSurface(value: unknown): value is SignupSurface {
  return typeof value === "string" && Object.hasOwn(SIGNUP_SURFACES, value);
}

/** What the person saw, as one line: the heading, the blurb, and the form itself. */
export function signupWording(surface: unknown): string {
  if (!isSignupSurface(surface)) return UNKNOWN_SURFACE_WORDING;
  const { heading, blurb } = SIGNUP_SURFACES[surface];
  return `${heading}${blurb ? ` — ${blurb}` : ""} [email address] [Subscribe]`;
}

export type OptInEvidence = { opt_in_at: string; opt_in_source: OptInSource; opt_in_wording: string | null };

export function optInEvidence(source: OptInSource, wording: string | null = null, now: Date = new Date()): OptInEvidence {
  return { opt_in_at: now.toISOString(), opt_in_source: source, opt_in_wording: wording };
}

export const OPT_IN_SOURCE_LABELS: Record<OptInSource, string> = {
  site_form: "Signed up on the site",
  console: "Added or opted in by an admin",
  bigin: "Imported from Bigin (date is the import, not a consent record)",
  // gap review area 7: scripts/import-mailchimp.ts, Mailchimp's own opt-in or confirm time
  mailchimp: "Signed up through the old Mailchimp list (Mailchimp's opt-in date)",
};
