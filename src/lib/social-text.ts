/** The lead-in's length budget: leaves an X post room for the link (23) and a few tags. */
export const SOCIAL_LEAD_MAX = 200;

/** Cut to the lead-in budget on a word boundary. */
export function trimLead(text: string, max = SOCIAL_LEAD_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/**
 * How long one channel's own wording may be (issue #101). X, and a channel
 * whose network isn't known, keep the item lead-in's budget: room for the
 * link and a few tags in 280. Elsewhere the wording can say more; this stays
 * well inside LinkedIn's and Facebook's own limits.
 */
export function leadMaxFor(network: string | null): number {
  const n = network?.toLowerCase();
  return !n || n === "twitter" || n === "x" ? SOCIAL_LEAD_MAX : 1500;
}

/** The post: the lead-in, then the link. Each channel's tags are appended after this (adapters/social channelText). */
export function composeSocialText(lead: string, url: string, max = SOCIAL_LEAD_MAX): string {
  return `${trimLead(lead, max)}\n\n${url}`;
}
