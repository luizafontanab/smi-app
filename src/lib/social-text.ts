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

/** The post: the lead-in, then the link. Each channel's tags are appended after this (adapters/social channelText). */
export function composeSocialText(lead: string, url: string): string {
  return `${trimLead(lead)}\n\n${url}`;
}
