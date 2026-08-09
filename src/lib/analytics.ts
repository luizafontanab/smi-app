import { headers } from "next/headers";
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

/** Fire-and-forget insert; analytics must never break a page render. */
export function record(events: EventRow[]): void {
  if (events.length === 0) return;
  const db = serviceDb();
  void db
    .from("analytics_events")
    .insert(events)
    .then(({ error }) => {
      if (error) console.error("[analytics] insert failed:", error.message);
    });
}

/** Request context for attribution: session hash, referrer, region/company via resolver. */
export async function requestContext() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const ua = h.get("user-agent") ?? "";
  const session_hash = simpleHash(`${ip}|${ua}`);
  const referrer = h.get("referer");
  const { resolveIp } = await import("./adapters/company-resolver");
  const { region, company } = await resolveIp(ip);
  return { session_hash, referrer, region, company };
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
