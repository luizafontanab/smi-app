import { describe, expect, it } from "vitest";
import { applyOptIn, newsletterChoiceOf } from "@/lib/contacts";

/**
 * The permanence rule from 20260808000002_commerce.sql:106 — "unsubscribed_at
 * is never cleared by sync, only by explicit re-opt-in" — as executable logic.
 */
describe("applyOptIn", () => {
  const NOW = new Date("2026-08-15T10:00:00.000Z");
  const unsubscribed = { subscribed: false, unsubscribed_at: "2026-02-01T09:00:00.000Z" };
  const clean = { subscribed: true, unsubscribed_at: null };

  it("ignores any change to an unsubscribed contact without an explicit re-opt-in", () => {
    expect(applyOptIn(unsubscribed, { newsletter: "subscribed", reOptIn: false }, NOW)).toEqual(unsubscribed);
    expect(applyOptIn(unsubscribed, { newsletter: "not_subscribed", reOptIn: false }, NOW)).toEqual(unsubscribed);
  });

  it("clears the permanent marker only on explicit re-opt-in", () => {
    expect(applyOptIn(unsubscribed, { newsletter: "subscribed", reOptIn: true }, NOW))
      .toEqual({ subscribed: true, unsubscribed_at: null });
  });

  it("stamps unsubscribed_at when a subscribed contact opts out", () => {
    expect(applyOptIn(clean, { newsletter: "unsubscribed", reOptIn: false }, NOW))
      .toEqual({ subscribed: false, unsubscribed_at: "2026-08-15T10:00:00.000Z" });
  });

  it("keeps 'not on the list' reversible — no permanent marker", () => {
    expect(applyOptIn(clean, { newsletter: "not_subscribed", reOptIn: false }, NOW))
      .toEqual({ subscribed: false, unsubscribed_at: null });
  });

  it("re-subscribes a soft-off contact without ceremony", () => {
    const soft = { subscribed: false, unsubscribed_at: null };
    expect(applyOptIn(soft, { newsletter: "subscribed", reOptIn: false }, NOW))
      .toEqual({ subscribed: true, unsubscribed_at: null });
  });
});

describe("newsletterChoiceOf", () => {
  it("maps the three states the console renders", () => {
    expect(newsletterChoiceOf({ subscribed: true, unsubscribed_at: null })).toBe("subscribed");
    expect(newsletterChoiceOf({ subscribed: false, unsubscribed_at: null })).toBe("not_subscribed");
    // a still-`subscribed` row with the marker set is unsubscribed — the marker wins
    expect(newsletterChoiceOf({ subscribed: true, unsubscribed_at: "2026-02-01T09:00:00.000Z" })).toBe("unsubscribed");
  });
});
