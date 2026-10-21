import { serviceDb } from "./db/server";
import { UUID_RE } from "./validate";

/**
 * Per-issue click tracking for the newsletter (gap review area 5 slice C,
 * Jas's SOP §1b.4 and Step 5).
 *
 * Every link in an issue carries `src=newsletter&issue=<id>`; advert links add
 * the `slot` they sat in. /visit and the story/video pages check the issue
 * exists and record it on the click (analytics_events.newsletter_issue_id).
 * /visit also adds the SOP's UTM tags to the advertiser's own link:
 *
 *   utm_source=newsletter&utm_medium=email&utm_campaign=smi-YYYY-MM&utm_content=<advertiser>-<slot>
 *
 * Old links without `issue` (every issue sent before this) still work: they
 * record as a newsletter click with no issue, exactly as before.
 */

/** The query string every link in an issue carries. */
export function newsletterParams(issueId: string, slot?: string): string {
  const params = new URLSearchParams({ src: "newsletter", issue: issueId });
  if (slot) params.set("slot", slot);
  return params.toString();
}

/** `smi-YYYY-MM`, from the month the issue goes out (scheduled, else sent, else now). */
export function campaignFor(sendAt: string | null | undefined, now = new Date()): string {
  const at = sendAt ? new Date(sendAt) : now;
  const date = Number.isNaN(at.getTime()) ? now : at;
  return `smi-${date.toISOString().slice(0, 7)}`;
}

/** Lower-case words joined by hyphens, for utm_content; never empty. */
export function utmSlug(value: string | null | undefined, fallback = "unknown"): string {
  const slug = (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || fallback;
}

/**
 * The advertiser's link with the SOP's UTM tags added. Only an external
 * http(s) address gets them: a fallback to the advertiser's member page is our
 * own site, where they mean nothing. A tag the advertiser already put in their
 * link is kept — it is their analytics.
 */
export function withUtm(target: string, campaign: string, content: string): string {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return target; // a relative, on-site path
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return target;
  const tags: Record<string, string> = { utm_source: "newsletter", utm_medium: "email", utm_campaign: campaign, utm_content: content };
  for (const [key, value] of Object.entries(tags)) if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The issue a newsletter link came from, when the link says so and the issue
 * is real — so a hand-edited URL can't attribute clicks to a made-up issue.
 * Null for an ordinary visit, an old link without `issue`, or a bad id.
 */
export async function issueFromLink(params: { src?: string | null; issue?: string | null }): Promise<{ id: string; campaign: string } | null> {
  if (params.src !== "newsletter" || !params.issue || !UUID_RE.test(params.issue)) return null;
  const { data } = await serviceDb().from("newsletter_issues").select("id, scheduled_at, sent_at").eq("id", params.issue).maybeSingle();
  return data ? { id: data.id, campaign: campaignFor(data.scheduled_at ?? data.sent_at) } : null;
}

/** The two params a page reads, from Next's searchParams (a repeated param counts as absent). */
export function newsletterLinkParams(sp: Record<string, string | string[] | undefined>): { src: string | null; issue: string | null } {
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  return { src: one(sp.src), issue: one(sp.issue) };
}

/** A slot label from a link, kept to what the email writes (`banner-2`, `sponsored`, `masthead`). */
export function slotFromLink(slot: string | null | undefined): string {
  return utmSlug(slot?.slice(0, 30), "advert");
}

export type IssueClickRow = { kind: string; story_id: string | null; advert_id: string | null; path: string | null; clicks: number; visitors: number };

/**
 * The SOP's post-send report for one issue: the most-clicked stories and
 * videos (top 5), and every attached advert's clicks — zeros included, since
 * "no clicks" is exactly what an advertiser's report has to be able to say.
 * Names come from the issue's own items and adverts; a row for something no
 * longer in the issue is still counted, under a generic name.
 */
export function summariseIssueClicks(
  rows: IssueClickRow[],
  items: { story?: { id: string; title: string } | null; video?: { slug: string; title: string } | null }[],
  ads: { advert_id: string; name: string }[],
): { top: { title: string; clicks: number; visitors: number }[]; adverts: { name: string; clicks: number; visitors: number }[] } {
  const storyTitle = new Map(items.flatMap((i) => (i.story ? [[i.story.id, i.story.title] as const] : [])));
  const videoTitle = new Map<string, string>(items.flatMap((i): [string, string][] => (i.video ? [[`/video/${i.video.slug}`, i.video.title]] : [])));
  const top = rows
    .flatMap((row) => {
      if (row.kind === "story_view" && row.story_id) return [{ title: storyTitle.get(row.story_id) ?? "A story no longer in this issue", clicks: Number(row.clicks), visitors: Number(row.visitors) }];
      if (row.kind === "page_view" && row.path?.startsWith("/video/")) return [{ title: videoTitle.get(row.path) ?? "A video no longer in this issue", clicks: Number(row.clicks), visitors: Number(row.visitors) }];
      return [];
    })
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);
  const adClicks = new Map(rows.filter((r) => r.kind === "ad_click" && r.advert_id).map((r) => [r.advert_id!, r]));
  const adverts = ads.map((ad) => ({ name: ad.name, clicks: Number(adClicks.get(ad.advert_id)?.clicks ?? 0), visitors: Number(adClicks.get(ad.advert_id)?.visitors ?? 0) }));
  for (const [advertId, row] of adClicks) {
    if (!ads.some((ad) => ad.advert_id === advertId)) adverts.push({ name: "An advert no longer in this issue", clicks: Number(row.clicks), visitors: Number(row.visitors) });
  }
  return { top, adverts };
}
