/**
 * Newsletter opt-in state transitions for a contact row.
 *
 * The schema comment on `contacts` (20260808000002_commerce.sql:106) is
 * load-bearing: "Unsubscribe is permanent: unsubscribed_at is never cleared by
 * sync, only by explicit re-opt-in." Encoding it here — rather than inline in
 * the server action — is what makes it testable, since the action ends in
 * redirect().
 */

export type OptInState = {
  subscribed: boolean;
  unsubscribed_at: string | null;
};

/** The three states the console renders today, as a form value. */
export type NewsletterChoice = "subscribed" | "not_subscribed" | "unsubscribed";

export const NEWSLETTER_CHOICES: readonly NewsletterChoice[] = ["subscribed", "not_subscribed", "unsubscribed"];

export function newsletterChoiceOf(state: OptInState): NewsletterChoice {
  if (state.unsubscribed_at) return "unsubscribed";
  return state.subscribed ? "subscribed" : "not_subscribed";
}

/**
 * Current state + what the form asked for → the state to store.
 *
 * A contact who has unsubscribed is immovable unless the admin ticks the
 * re-opt-in box, which stands for "they told us, out of band, that they want
 * back on the list". Without that tick the requested choice is ignored
 * entirely, so a mis-click on the select can never resurrect them.
 *
 * Note the distinction between the two "off" states: `not_subscribed` simply
 * means not on the list (reversible), while `unsubscribed` stamps the
 * permanent marker that sync must never clear.
 */
export function applyOptIn(
  current: OptInState,
  input: { newsletter: NewsletterChoice; reOptIn: boolean },
  now: Date = new Date(),
): OptInState {
  if (current.unsubscribed_at) {
    if (!input.reOptIn) return { subscribed: current.subscribed, unsubscribed_at: current.unsubscribed_at };
    // explicit re-opt-in — the one route back onto the list
    return { subscribed: true, unsubscribed_at: null };
  }

  switch (input.newsletter) {
    case "unsubscribed":
      return { subscribed: false, unsubscribed_at: now.toISOString() };
    case "not_subscribed":
      return { subscribed: false, unsubscribed_at: null };
    default:
      return { subscribed: true, unsubscribed_at: null };
  }
}
