import { cookies, headers } from "next/headers";
import { CONSENT_COOKIE } from "./consent";
import { serviceDb } from "./db/server";

/**
 * First-party analytics. Numbers must be REAL — no inflation, no padding
 * (requirements/05-platform-layer.md). Region is always attempted; company
 * comes from the optional resolver adapter (stubbed until approved).
 */

export type EventKind =
  | "page_view"
  | "story_view"
  | "member_page_view"
  | "ad_impression"
  | "ad_click"
  | "outbound_click"
  | "phone_click"
  | "email_click"
  | "social_click"
  /** A video page view, attributed to the video's member for Content reach (GAPS A9.2). */
  | "video_view";

type EventRow = {
  kind: EventKind;
  path?: string;
  story_id?: string | null;
  member_id?: string | null;
  advert_id?: string | null;
  region?: string | null;
  company?: string | null;
  session_hash?: string | null;
  referrer?: string | null;
  /** Only meaningful for kind: "social_click", e.g. "linkedin". */
  platform?: string | null;
};

export { CONSENT_COOKIE } from "./consent";

/**
 * V15: "analytics tracking respects the choice". Consent must be affirmative,
 * so ONLY an explicit "all" enables recording — "essential" and the absent
 * cookie (first visit, banner still up) both mean no. Withholding is handled
 * in requestContext() rather than at the insert, so a declining reader's IP
 * and user-agent are never hashed in the first place.
 */
export async function analyticsConsented(): Promise<boolean> {
  return (await cookies()).get(CONSENT_COOKIE)?.value === "all";
}

/** Marks a context built without consent; stripped before the row is written. */
type Consent = { consented: boolean };

const DECLINED: RequestContext = {
  session_hash: null,
  referrer: null,
  region: null,
  company: null,
  consented: false,
};

export type RequestContext = {
  session_hash: string | null;
  referrer: string | null;
  region: string | null;
  company: string | null;
} & Consent;

/**
 * Fire-and-forget insert; analytics must never break a page render.
 * Rows carrying `consented: false` are dropped here — that flag rides along
 * from requestContext() so every call site is gated without having to
 * remember to check, and it is never persisted (no such column exists).
 */
export function record(events: (EventRow & Partial<Consent>)[]): void {
  const rows: EventRow[] = [];
  for (const event of events) {
    if (event.consented === false) continue;
    const row = { ...event };
    delete row.consented; // no such column — the flag only ever rides in memory
    rows.push(row);
  }
  if (rows.length === 0) return;
  const db = serviceDb();
  void db
    .from("analytics_events")
    .insert(rows)
    .then(({ error }) => {
      if (error) console.error("[analytics] insert failed:", error.message);
    });
}

type SearchQueryRow = { query: string; results_count: number; session_hash?: string | null };

/**
 * A5.1: what readers actually search for feeds SEO / AI-search decisions
 * (V4) — dropped entirely until now. Same fire-and-forget / consent-drop
 * shape as record().
 */
export function recordSearch(entry: SearchQueryRow & Partial<Consent>): void {
  if (entry.consented === false) return;
  const row: SearchQueryRow = { query: entry.query, results_count: entry.results_count, session_hash: entry.session_hash };
  void serviceDb()
    .from("search_queries")
    .insert(row)
    .then(({ error }) => {
      if (error) console.error("[analytics] search_queries insert failed:", error.message);
    });
}

export type ReferrerBucket = "direct" | "search" | "social" | "ai" | "other";

const SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "yahoo.com", "ecosia.org"];
const SOCIAL_HOSTS = ["facebook.com", "linkedin.com", "x.com", "twitter.com", "instagram.com", "youtube.com", "tiktok.com"];
/** Best-effort, hand-maintained: catches a reader following a link an AI
 * product surfaced (referrer = that product's own domain). Does not catch
 * crawler/bot traffic, which is User-Agent-based and out of scope here. */
const AI_HOSTS = ["chatgpt.com", "chat.openai.com", "perplexity.ai", "gemini.google.com", "copilot.microsoft.com", "claude.ai"];

/** Buckets a raw Referer header for the admin analytics referrer-mix view. Read-time only — never stored. */
export function classifyReferrer(referrer: string | null | undefined): ReferrerBucket {
  if (!referrer) return "direct";
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (AI_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "ai";
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return "search";
  if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return "social";
  return "other";
}

/**
 * Fire-and-forget, no PII: one row/day, two counters. This is the
 * measurement half of GAPS C6's disclosure — record() drops every
 * non-consented event, so without this there is no way to say how large
 * that undercount actually is.
 */
function bumpConsentStats(consented: boolean): void {
  void serviceDb()
    .rpc("bump_consent_stats", { p_consented: consented })
    .then(({ error }) => {
      if (error) console.error("[analytics] bump_consent_stats failed:", error.message);
    });
}

/** Request context for attribution: session hash, referrer, region/company via resolver. */
export async function requestContext(): Promise<RequestContext> {
  const consented = await analyticsConsented();
  bumpConsentStats(consented);
  if (!consented) return DECLINED;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const ua = h.get("user-agent") ?? "";
  const session_hash = simpleHash(`${ip}|${ua}`);
  const referrer = h.get("referer");
  const { resolveIp } = await import("./adapters/company-resolver");
  const { region, company } = await resolveIp(ip);
  return { session_hash, referrer, region, company, consented: true };
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
