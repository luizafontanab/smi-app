import { userAgent } from "next/server";

/**
 * Obvious non-human traffic, by User-Agent, for the click-throughs that count
 * something (/go/[memberId], /visit/[id]). A crawler following a story's
 * company line is not a reader clicking through to the member, and every one
 * of those GETs used to reach requestContext() — which bumps consent_stats on
 * each call, consented or not, so bots were inflating the "declined" share
 * GAPS C6's undercount disclosure is built on (the event row itself was
 * already dropped for a cookieless crawler; record() only keeps consented
 * ones).
 *
 * "Obvious" is the bar: Next's own isBot list (Googlebot, Bingbot, the social
 * link-preview fetchers, GPTBot…) plus self-declared crawlers and HTTP
 * libraries. A bot that pretends to be Chrome passes — this is a filter for
 * honest robots, not a defence against fraud. No UA at all counts as a bot:
 * every browser sends one.
 */
const MORE_BOTS =
  /(?<!cu)bot\b|bot\/|spider|crawl|slurp|headlesschrome|lighthouse|preview|embedly|scrapy|^curl\/|^wget\/|python-|go-http-client|node-fetch|undici|axios\/|okhttp|java\/|libwww|httpclient/i;

export function isObviousBot(headers: Headers): boolean {
  const ua = headers.get("user-agent")?.trim() ?? "";
  if (!ua) return true;
  return userAgent({ headers }).isBot || MORE_BOTS.test(ua);
}
