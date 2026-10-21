/**
 * The newsletter proof checklist and the audience check (gap review area 4).
 *
 * Jas's Monthly Newsletter SOP (16 Oct), Step 2: "No issue sends until the
 * proofreader has ticked every box below and the publisher has given written
 * approval." The items are his, word for word, grouped as he grouped them. The
 * keys are what `newsletter_issues.proof_checks` stores, so never rename one —
 * a renamed key reads as unticked on every issue.
 *
 * Some items can't honestly be ticked until later areas land (postal address
 * and reason-for-receiving line, "Sheet Metal Industries" as sender, UTM tags,
 * the "Sponsored" label). That is intended: approval waits for them.
 */

export type ProofItem = { key: string; label: string };
export type ProofGroup = { title: string; items: ProofItem[] };

export const PROOF_CHECKLIST: ProofGroup[] = [
  {
    title: "Content",
    items: [
      { key: "content_matches", label: "Headlines, summaries, names, company names and figures match the published stories" },
      { key: "spelling_style", label: "Spelling and grammar checked; house style for units (mm, kN, tonnes) and trade terms" },
      { key: "issue_details", label: "Issue date, month and edition number are correct everywhere" },
      { key: "subject_preview", label: "Subject line and preview text read well and are not spammy (no all-caps, no \"FREE!!!\")" },
    ],
  },
  {
    title: "Links and images",
    items: [
      { key: "story_links", label: "Every story link opens the right live page on sheetmetalindustries.com" },
      { key: "ad_links", label: "Every ad links to the advertiser's approved URL and carries its UTM tag" },
      { key: "images", label: "Every image loads, is sharp, has alt text and is under 200 KB" },
      { key: "footer_links", label: "Social, website and contact links in the footer work" },
    ],
  },
  {
    title: "Adverts",
    items: [
      { key: "ads_booked", label: "Every booked ad in the CRM appears in its paid slot, and nothing unbooked appears" },
      { key: "sponsored_label", label: "Sponsored content is labelled \"Sponsored\"" },
      { key: "advertiser_approved", label: "Advertiser has approved the proof (screenshot or PDF sent at S − 3; reply saved in the issue folder)" },
    ],
  },
  {
    title: "Technical and compliance",
    items: [
      { key: "mobile_dark", label: "Displays correctly on mobile and in dark mode" },
      { key: "unsubscribe_links", label: "Unsubscribe link and \"manage preferences\" link work" },
      { key: "footer_compliance", label: "Postal address and reason-for-receiving line are in the footer" },
      { key: "sender_reply_to", label: "Sender name is \"Sheet Metal Industries\" and reply-to is a monitored inbox" },
      { key: "audience", label: "Correct audience segment selected; recipient count within 5% of last month (investigate any bigger change)" },
      { key: "spam_check", label: "Spam and inbox-preview check passed" },
    ],
  },
];

export const PROOF_KEYS: string[] = PROOF_CHECKLIST.flatMap((group) => group.items.map((item) => item.key));

/** `proof_checks` as stored: only known keys, only `true`. Anything else in the jsonb is ignored. */
export function tickedKeys(stored: unknown): Set<string> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Set();
  const record = stored as Record<string, unknown>;
  return new Set(PROOF_KEYS.filter((key) => record[key] === true));
}

/** The items still unticked, in checklist order. Empty means the proof is complete. */
export function missingChecks(stored: unknown): ProofItem[] {
  const ticked = tickedKeys(stored);
  return PROOF_CHECKLIST.flatMap((group) => group.items).filter((item) => !ticked.has(item.key));
}

/** The SOP's limit: "recipient count within 5% of last month (investigate any bigger change)". */
export const AUDIENCE_DRIFT_LIMIT_PCT = 5;

/**
 * How far this issue's audience is from the last sent issue's, in percent.
 * Null when there's no baseline (no earlier issue recorded a `sent_count`, or
 * it was 0), since a percentage against nothing would mean nothing.
 */
export function audienceDrift(current: number, lastSent: number | null | undefined): { pct: number; withinLimit: boolean } | null {
  if (!lastSent || lastSent <= 0) return null;
  const pct = ((current - lastSent) / lastSent) * 100;
  return { pct, withinLimit: Math.abs(pct) <= AUDIENCE_DRIFT_LIMIT_PCT };
}
