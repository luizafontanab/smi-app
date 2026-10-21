import { redirect } from "next/navigation";
import { serviceDb } from "@/lib/db/server";
import { newsletterClick, record, requestContext } from "@/lib/analytics";
import { resolveAdvertTarget } from "@/lib/adverts";
import { isObviousBot } from "@/lib/bots";
import { isMemberLinkable } from "@/lib/member-visibility";
import { issueFromLink, slotFromLink, utmSlug, withUtm } from "@/lib/newsletter-tracking";

/**
 * Advert click-through: record the click, then send the reader on.
 *
 * DO NOT rename this back to something like /out/, /click/ or /ads/. Those
 * fragments sit in EasyList, so a reader with an ad blocker never reaches the
 * advertiser — the click is silently dropped and we undercount what we sold.
 * Same reason the artwork lives under media/panels/ and not media/adverts/.
 * The advert itself stays honestly labelled (aria-label="Advert: …" in AdSlot);
 * this is only about generic filename heuristics eating first-party creative.
 */
export async function GET(req: Request, ctx: RouteContext<"/visit/[id]">) {
  const { id } = await ctx.params;
  const db = serviceDb();
  const { data: ad } = await db
    .from("adverts")
    .select("id, name, link_url, member:members(id, slug, status, archived_at)")
    .eq("id", id)
    .maybeSingle();
  if (!ad) redirect("/");
  // Gap review area 5: a link from a newsletter issue names the issue and the
  // slot it sat in. Only a real issue is recorded (lib/newsletter-tracking).
  const params = new URL(req.url).searchParams;
  const issue = await issueFromLink({ src: params.get("src"), issue: params.get("issue") });
  // A crawler is redirected like anyone else but never counted as a paid
  // click (lib/bots) — robots.ts already disallows /visit/ for those that listen.
  if (!isObviousBot(req.headers)) {
    // A newsletter click is counted without consent too, anonymously (lib/analytics newsletterClick).
    const reqCtx = newsletterClick(await requestContext(), params.get("src"));
    record([{ kind: "ad_click", advert_id: ad.id, member_id: ad.member?.id ?? null, path: resolveClickPath(req), newsletter_issue_id: issue?.id ?? null, ...reqCtx }]);
  }
  // An advert with no usable link_url (none, or one resolveAdvertTarget can't
  // make a web address of) falls back to its advertiser's member page. That
  // page 404s for an archived or lapsed member, so the fallback has to be
  // withdrawn with it — a paid click landing on "not found" is worse than one
  // landing on the homepage. The click itself is still recorded either way:
  // the advertiser paid for the impression and the click happened.
  // This is serviceDb(), so RLS does not do it for us (fix-list 72).
  const target = isMemberLinkable(ad.member) ? ad.member.slug : null;
  const destination = resolveAdvertTarget(ad.link_url, target);
  // The SOP's UTM tags, on the advertiser's own site only (withUtm).
  redirect(issue ? withUtm(destination, issue.campaign, `${utmSlug(ad.member?.slug ?? ad.name)}-${slotFromLink(params.get("slot"))}`) : destination);
}

/**
 * Newsletter clicks arrive with an untrustworthy or absent Referer (email
 * clients), so a confirmed `?src=newsletter` query param wins first, using the
 * sentinel string "newsletter" — distinguishable from real routes, which
 * always start with "/". A same-origin on-site click carries the real path in
 * Referer by default browser policy. Anything else (cross-origin referrer, no
 * referrer, non-browser client) records "unknown" rather than guessing.
 */
export function resolveClickPath(req: Request): string {
  const url = new URL(req.url);
  if (url.searchParams.get("src") === "newsletter") return "newsletter";
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const refUrl = new URL(referer);
      if (refUrl.origin === url.origin) return refUrl.pathname;
    } catch {
      // malformed Referer — fall through to "unknown"
    }
  }
  return "unknown";
}
