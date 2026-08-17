import { cookies, headers } from "next/headers";
import { serviceDb } from "./db/server";

/**
 * First-party analytics. Numbers must be REAL — no inflation, no padding
 * (requirements/05-platform-layer.md). Region is always attempted; company
 * comes from the optional resolver adapter (stubbed until approved).
 */

export type EventKind = "page_view" | "story_view" | "member_page_view" | "ad_impression" | "ad_click";

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
};

/** The cookie CookieConsent.tsx writes. Kept in one place so the two agree. */
export const CONSENT_COOKIE = "smi-consent";

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

/** Request context for attribution: session hash, referrer, region/company via resolver. */
export async function requestContext(): Promise<RequestContext> {
  if (!(await analyticsConsented())) return DECLINED;
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
