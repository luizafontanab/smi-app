import { describe, expect, it } from "vitest";
import { optInEvidence, signupWording, SIGNUP_SURFACES, UNKNOWN_SURFACE_WORDING } from "@/lib/newsletter-consent";

describe("signupWording", () => {
  it("records the surface's heading and blurb, and the form itself", () => {
    expect(signupWording("footer")).toBe("Monthly newsletter [email address] [Subscribe]");
    expect(signupWording("home_card")).toBe(`${SIGNUP_SURFACES.home_card.heading} — ${SIGNUP_SURFACES.home_card.blurb} [email address] [Subscribe]`);
  });

  it("never guesses for a missing or unknown surface, including inherited keys", () => {
    for (const v of [null, "", "nope", "toString", "__proto__"]) expect(signupWording(v)).toBe(UNKNOWN_SURFACE_WORDING);
  });
});

describe("optInEvidence", () => {
  it("stamps the time, the route and the wording", () => {
    const now = new Date("2026-10-21T10:00:00Z");
    expect(optInEvidence("console", null, now)).toEqual({ opt_in_at: "2026-10-21T10:00:00.000Z", opt_in_source: "console", opt_in_wording: null });
  });
});
